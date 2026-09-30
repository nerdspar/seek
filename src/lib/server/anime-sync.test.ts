import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reconcileAnimeTags } from './anime-sync';

const S = (...ids: string[]) => new Set(ids);

describe('reconcileAnimeTags', () => {
	it('tags a tracked anime show that is not yet tagged', () => {
		expect(reconcileAnimeTags(S('1', '2'), S('1', '2', '3'), S())).toEqual({
			add: ['1', '2'],
			remove: []
		});
	});

	it('untags a show that is no longer in the Anime library', () => {
		expect(reconcileAnimeTags(S('1'), S('1', '2'), S('1', '2'))).toEqual({
			add: [],
			remove: ['2']
		});
	});

	it('is a no-op when tags already match', () => {
		expect(reconcileAnimeTags(S('1', '2'), S('1', '2', '9'), S('1', '2'))).toEqual({
			add: [],
			remove: []
		});
	});

	it('ignores anime ids that are not tracked in Floppy', () => {
		// '5' is anime in Jellyfin but not tracked → nothing to tag
		expect(reconcileAnimeTags(S('1', '5'), S('1'), S())).toEqual({ add: ['1'], remove: [] });
	});

	it('both adds and removes in one pass', () => {
		expect(reconcileAnimeTags(S('1', '3'), S('1', '2', '3'), S('2'))).toEqual({
			add: ['1', '3'],
			remove: ['2']
		});
	});
});

// Orchestration: mock the I/O boundaries and assert the writes.
vi.mock('./jellyfin', () => ({
	jellyfinConfigured: vi.fn(() => true),
	fetchAnimeTmdbIds: vi.fn()
}));
vi.mock('./watchlist', () => ({ getWatchlist: vi.fn() }));
vi.mock('./tags', async (orig) => ({
	...(await orig<typeof import('./tags')>()),
	setItemTag: vi.fn()
}));
vi.mock('./memo', () => ({ expire: vi.fn(), memo: vi.fn(), patch: vi.fn(), invalidate: vi.fn(), put: vi.fn() }));

import { syncAnimeTags } from './anime-sync';
import { jellyfinConfigured, fetchAnimeTmdbIds } from './jellyfin';
import { getWatchlist } from './watchlist';
import { setItemTag, ANIME_TAG } from './tags';

const rows = (...ids: string[]) => ({ rows: ids.map((id) => ({ source: 'tmdb', mediaId: id })), total: ids.length, hasMore: false });

describe('syncAnimeTags', () => {
	beforeEach(() => vi.clearAllMocks());

	it('short-circuits when Jellyfin is not configured', async () => {
		vi.mocked(jellyfinConfigured).mockReturnValue(false);
		const res = await syncAnimeTags();
		expect(res.skipped).toBe('jellyfin-not-configured');
		expect(fetchAnimeTmdbIds).not.toHaveBeenCalled();
		expect(setItemTag).not.toHaveBeenCalled();
	});

	it('tags the tracked anime shows and untags stale ones', async () => {
		vi.mocked(jellyfinConfigured).mockReturnValue(true);
		vi.mocked(fetchAnimeTmdbIds).mockResolvedValue(S('1', '2'));
		vi.mocked(getWatchlist)
			.mockResolvedValueOnce(rows('1', '2', '3') as never) // tracked tv
			.mockResolvedValueOnce(rows('2', '9') as never); // currently anime-tagged

		const res = await syncAnimeTags();

		// '1' is anime & tracked & untagged → add; '9' tagged but not anime → remove
		expect(vi.mocked(setItemTag).mock.calls).toEqual(
			expect.arrayContaining([
				['tv', 'tmdb', '1', ANIME_TAG, true, { expireWatchlist: false }],
				['tv', 'tmdb', '9', ANIME_TAG, false, { expireWatchlist: false }]
			])
		);
		expect(res).toMatchObject({ added: 1, removed: 1, animeInJellyfin: 2 });
	});
});
