import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { animeByGenres, reconcileAnimeTags, verdict } from './anime-sync';

const S = (...ids: string[]) => new Set(ids);

describe('reconcileAnimeTags', () => {
	it('tags a tracked anime show that is not yet tagged', () => {
		expect(reconcileAnimeTags(S('1', '2'), S('1', '2', '3'), S())).toEqual({
			add: ['1', '2'],
			remove: []
		});
	});

	it('untags a show that is no longer anime', () => {
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
		// '5' is anime but not tracked → nothing to tag
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
type Item = { media_id: string; genres?: string[]; implied_genres?: string[] };
let library: Item[] = [];
const detail = new Map<string, string[]>();
vi.mock('./floppy', () => ({
	floppy: vi.fn(async (path: string, opts?: { query?: { offset?: number; limit?: number } }) => {
		if (path === '/api/v1/media/tv/') {
			const off = opts?.query?.offset ?? 0;
			const lim = opts?.query?.limit ?? 100;
			return {
				results: library.slice(off, off + lim).map((it) => ({ item: { source: 'tmdb', ...it } })),
				pagination: { total: library.length }
			};
		}
		const m = path.match(/\/tv\/tmdb\/([^/]+)\/$/);
		if (m) return { genres: detail.get(m[1]) ?? [] };
		throw new Error(`unexpected ${path}`);
	})
}));
vi.mock('./watchlist', () => ({ getWatchlist: vi.fn() }));
vi.mock('./tags', async (orig) => ({
	...(await orig<typeof import('./tags')>()),
	setItemTag: vi.fn(),
	getItemTags: vi.fn(async () => [])
}));
vi.mock('./memo', () => ({ expire: vi.fn(), memo: vi.fn(), patch: vi.fn(), invalidate: vi.fn(), put: vi.fn() }));

import { classifyShow, setAnimeOverride, syncAnimeTags } from './anime-sync';
import { getWatchlist } from './watchlist';
import { getItemTags, setItemTag, ANIME_TAG } from './tags';
import { openDatabase, useDatabase } from './db';
import * as users from './users';
import { runAs } from './userctx';

const rows = (...ids: string[]) => ({ rows: ids.map((id) => ({ source: 'tmdb', mediaId: id })), total: ids.length, hasMore: false });
const ANIME = ['Animation', 'Anime', 'Action & Adventure'];
const WESTERN_ANIMATION = ['Animation', 'Action & Adventure'];

describe('animeByGenres', () => {
	it("is anime when Floppy's genres (or implied genres) say Anime", () => {
		expect(animeByGenres(ANIME)).toBe(true);
		expect(animeByGenres(['Animation'], ['anime'])).toBe(true);
		expect(animeByGenres(WESTERN_ANIMATION)).toBe(false); // Invincible, Vox Machina
	});
	it('cannot say when Floppy has no genres yet', () => {
		expect(animeByGenres([])).toBeNull();
		expect(animeByGenres(undefined, null)).toBeNull();
	});
});

describe('verdict', () => {
	it("the household's override beats the genre, either way", () => {
		const o = new Map([
			['1', true],
			['2', false]
		]);
		expect(verdict('1', false, o)).toBe(true); // Ninja Kamui-style call
		expect(verdict('2', true, o)).toBe(false);
		expect(verdict('3', null, o)).toBeNull();
	});
});

let owner: users.User;
beforeEach(async () => {
	vi.clearAllMocks();
	library = [];
	detail.clear();
	process.env.SEEK_TOKEN_KEY = 'test-token-key';
	useDatabase(openDatabase(':memory:'));
	owner = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
});
afterEach(() => useDatabase(null));

describe('syncAnimeTags', () => {
	it('tags what Floppy calls anime, untags what it does not, and leaves shows it has no genres for', async () => {
		library = [
			{ media_id: '1', genres: ANIME }, // Demon Slayer, watched on Netflix: gains the tag
			{ media_id: '2', genres: ANIME }, // already tagged: untouched
			{ media_id: '3', genres: ['Drama'] },
			{ media_id: '8', genres: [] }, // tagged, no genres yet: keeps its tag
			{ media_id: '9', genres: WESTERN_ANIMATION } // Invincible, from the Jellyfin Anime folder: loses it
		];
		vi.mocked(getWatchlist).mockResolvedValueOnce(rows('2', '8', '9') as never);
		const res = await runAs(owner, () => syncAnimeTags());
		expect(res).toMatchObject({ added: 1, removed: 1, anime: 3 });
		expect(setItemTag).toHaveBeenCalledWith('tv', 'tmdb', '1', ANIME_TAG, true, { expireWatchlist: false });
		expect(setItemTag).toHaveBeenCalledWith('tv', 'tmdb', '9', ANIME_TAG, false, { expireWatchlist: false });
		expect(setItemTag).toHaveBeenCalledTimes(2);
	});

	it('reads the whole library, page by page', async () => {
		library = Array.from({ length: 250 }, (_, i) => ({ media_id: String(i), genres: i === 249 ? ANIME : ['Drama'] }));
		vi.mocked(getWatchlist).mockResolvedValueOnce(rows() as never);
		await runAs(owner, () => syncAnimeTags());
		expect(setItemTag).toHaveBeenCalledWith('tv', 'tmdb', '249', ANIME_TAG, true, { expireWatchlist: false });
	});

	it("follows the household's override over the genre", async () => {
		library = [{ media_id: '9', genres: WESTERN_ANIMATION }];
		setAnimeOverride(owner.householdId, owner.id, '9', true);
		vi.mocked(getWatchlist).mockResolvedValueOnce(rows() as never);
		await runAs(owner, () => syncAnimeTags());
		expect(setItemTag).toHaveBeenCalledWith('tv', 'tmdb', '9', ANIME_TAG, true, { expireWatchlist: false });
	});
});

describe('classifyShow (just added, or just overruled)', () => {
	it('tags a new anime show at once, and does nothing when the tag already matches', async () => {
		detail.set('1', ANIME);
		expect(await runAs(owner, () => classifyShow('1'))).toBe(true);
		expect(setItemTag).toHaveBeenCalledWith('tv', 'tmdb', '1', ANIME_TAG, true, { expireWatchlist: false });
		vi.mocked(setItemTag).mockClear();
		vi.mocked(getItemTags).mockResolvedValueOnce([ANIME_TAG]);
		expect(await runAs(owner, () => classifyShow('1'))).toBe(true);
		expect(setItemTag).not.toHaveBeenCalled();
	});

	it('an override needs no genre lookup', async () => {
		setAnimeOverride(owner.householdId, owner.id, '7', false);
		vi.mocked(getItemTags).mockResolvedValueOnce([ANIME_TAG]);
		expect(await runAs(owner, () => classifyShow('7'))).toBe(false);
		expect(setItemTag).toHaveBeenCalledWith('tv', 'tmdb', '7', ANIME_TAG, false, { expireWatchlist: false });
	});

	it('never throws, and leaves a show alone when nobody can say', async () => {
		expect(await runAs(owner, () => classifyShow('404'))).toBeNull();
		vi.mocked(setItemTag).mockRejectedValueOnce(new Error('Floppy down'));
		detail.set('2', ANIME);
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await runAs(owner, () => classifyShow('2'))).toBeNull();
		warn.mockRestore();
	});
});
