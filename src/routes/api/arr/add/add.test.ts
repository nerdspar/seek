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
const track = vi.fn(async (..._a: unknown[]) => ({ already: false }));
vi.mock('$lib/server/tracking/add', () => ({ addTitle: (...a: unknown[]) => track(...a) }));
vi.mock('$lib/server/userctx', () => ({ currentUser: () => ({ id: 1, householdId: 1 }) }));
vi.mock('$lib/server/memo', () => ({ expire: vi.fn(), invalidate: vi.fn() }));
const settleAdded = vi.fn((..._a: unknown[]) => 'pending');
vi.mock('$lib/server/household/run', () => ({ settleAdded: (...a: unknown[]) => settleAdded(...a) }));

import { POST } from './+server';

const add = async (body: unknown) =>
	(await POST({ request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) } as never)).json();

beforeEach(() => {
	addTitle.mockReset().mockResolvedValue({ ok: true });
	track.mockClear();
	settleAdded.mockClear();
});

describe('downloading a show or film', () => {
	it('also puts it on your list', async () => {
		expect(await add({ mediaType: 'movie', tmdbId: 603 })).toMatchObject({ ok: true, tracked: true });
		expect(track).toHaveBeenCalledWith(1, 'movie', 603);
	});

	it('never fails the download over the list', async () => {
		track.mockRejectedValueOnce(new Error('disk full'));
		expect(await add({ mediaType: 'tv', tmdbId: 2 })).toMatchObject({ ok: true, tracked: false });
	});

	it("settles together or solo for a show: the form's answer, else the household setting", async () => {
		expect(await add({ mediaType: 'tv', tmdbId: 1, title: 'Lanterns', together: true })).toMatchObject({ household: 'pending' });
		expect(settleAdded).toHaveBeenLastCalledWith({ source: 'tmdb', mediaId: '1', title: 'Lanterns' }, 'together');
		await add({ mediaType: 'tv', tmdbId: 2 });
		expect(settleAdded).toHaveBeenLastCalledWith({ source: 'tmdb', mediaId: '2', title: null }, undefined);
		await add({ mediaType: 'movie', tmdbId: 3 });
		expect(settleAdded).toHaveBeenCalledTimes(2);
	});
});
