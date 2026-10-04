import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchReleases = vi.fn();
const grabRelease = vi.fn();
vi.mock('$lib/server/books/bookorbit', () => ({
	searchReleases: (...a: unknown[]) => searchReleases(...a),
	grabRelease: (...a: unknown[]) => grabRelease(...a),
	BookOrbitError: class extends Error {}
}));

const wantIfNew = vi.fn(async (..._a: unknown[]) => {});
vi.mock('$lib/server/books/shelf', () => ({ wantIfNew: (...a: unknown[]) => wantIfNew(...a) }));

import { POST } from './+server';
import { mapReleaseSearch } from '$lib/books';

const call = async (body: unknown) => {
	const res = await POST({
		params: { id: '3' },
		request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) })
	} as never);
	return res.json();
};

beforeEach(() => {
	searchReleases.mockReset();
	grabRelease.mockReset().mockResolvedValue({ id: 3, status: 'grabbed', hardcoverId: 7, title: 'Dune', author: 'Frank Herbert', coverUrl: null });
	wantIfNew.mockClear();
});

describe('Automatic download', () => {
	it('grabs the best release that fits', async () => {
		searchReleases.mockResolvedValue(
			mapReleaseSearch({
				releases: [
					{ indexerId: 1, guid: 'low', score: 10 },
					{ indexerId: 2, guid: 'best', score: 90 }
				],
				indexers: [{ ok: true }],
				enabledIndexerCount: 1
			})
		);
		const out = await call({ auto: true });
		expect(out.grabbed).toBe(true);
		expect(grabRelease).toHaveBeenCalledWith(3, expect.objectContaining({ indexerId: 2, guid: 'best' }));
		// Only a real download puts the book on your list.
		expect(wantIfNew).toHaveBeenCalledWith(7);
	});

	it('says why when there is nothing to grab, and grabs nothing', async () => {
		searchReleases.mockResolvedValue(mapReleaseSearch({ releases: [], indexers: [{ ok: true }], enabledIndexerCount: 1 }));
		const out = await call({ auto: true });
		expect(out).toMatchObject({ grabbed: false, reason: 'No releases found (searched 1 source).' });
		expect(grabRelease).not.toHaveBeenCalled();
		expect(wantIfNew).not.toHaveBeenCalled();
	});

	it('grabs exactly the release you picked', async () => {
		await call({ indexerId: 4, guid: 'yours' });
		expect(grabRelease).toHaveBeenCalledWith(3, { indexerId: 4, guid: 'yours' });
	});
});
