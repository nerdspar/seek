import { describe, it, expect, vi, beforeEach } from 'vitest';

const addTitle = vi.fn();
vi.mock('$lib/server/arr', () => ({
	addTitle: (...a: unknown[]) => addTitle(...a),
	configured: () => true,
	getOptions: async () => ({ rootFolders: [{ path: '/tv' }], profiles: [{ id: 1 }] }),
	ArrError: class extends Error {},
	ArrUnreachable: class extends Error {}
}));
vi.mock('$lib/server/prefs', () => ({ getPrefs: async () => ({ sonarr: null, radarr: null }) }));
const addMedia = vi.fn();
vi.mock('$lib/server/search', () => ({ addMedia: (...a: unknown[]) => addMedia(...a) }));
const { FloppyError } = vi.hoisted(() => ({
	FloppyError: class extends Error {
		constructor(readonly status: number) {
			super('floppy');
		}
	}
}));
vi.mock('$lib/server/floppy', () => ({ FloppyError }));
vi.mock('$lib/server/memo', () => ({ expire: vi.fn(), invalidate: vi.fn() }));
const settleAdded = vi.fn((..._a: unknown[]) => 'pending');
vi.mock('$lib/server/household/run', () => ({ settleAdded: (...a: unknown[]) => settleAdded(...a) }));

import { POST } from './+server';

const add = async (body: unknown) =>
	(await POST({ request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) } as never)).json();

beforeEach(() => {
	addTitle.mockReset().mockResolvedValue({ ok: true });
	addMedia.mockReset();
	settleAdded.mockClear();
});

describe('downloading a show or film', () => {
	it('also puts it in your Floppy library', async () => {
		addMedia.mockResolvedValue({});
		expect(await add({ mediaType: 'movie', tmdbId: 603 })).toMatchObject({ ok: true, tracked: true });
		expect(addMedia).toHaveBeenCalledWith('movie', 'tmdb', '603');
	});

	it('is fine when it was already tracked, and never fails the download over Floppy', async () => {
		addMedia.mockRejectedValueOnce(new FloppyError(409));
		expect((await add({ mediaType: 'tv', tmdbId: 1 })).tracked).toBe(true);
		addMedia.mockRejectedValueOnce(new Error('Floppy down'));
		expect(await add({ mediaType: 'tv', tmdbId: 2 })).toMatchObject({ ok: true, tracked: false });
	});

	it("settles together or solo for a show: the form's answer, else the household setting", async () => {
		addMedia.mockResolvedValue({});
		expect(await add({ mediaType: 'tv', tmdbId: 1, title: 'Lanterns', together: true })).toMatchObject({ household: 'pending' });
		expect(settleAdded).toHaveBeenLastCalledWith({ source: 'tmdb', mediaId: '1', title: 'Lanterns' }, 'together');
		await add({ mediaType: 'tv', tmdbId: 2 });
		expect(settleAdded).toHaveBeenLastCalledWith({ source: 'tmdb', mediaId: '2', title: null }, undefined);
		await add({ mediaType: 'movie', tmdbId: 3 });
		expect(settleAdded).toHaveBeenCalledTimes(2);
	});
});
