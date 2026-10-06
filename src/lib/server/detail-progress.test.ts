import { describe, it, expect, vi, beforeEach } from 'vitest';

/* Floppy as it answered for Widow's Bay after only E10 was marked: the season's
   `progress` is the furthest episode reached (10), not a count, and its status
   is In progress (1), not Completed (3). */
const responses = new Map<string, unknown>();
vi.mock('./floppy', () => ({
	floppy: async (path: string) => {
		if (!responses.has(path)) throw new Error(`unexpected ${path}`);
		return responses.get(path);
	}
}));

import { getShow } from './detail';

const ep = (n: number, plays: number) => ({ progress: plays, item: { season_number: 1, episode_number: n } });
const season = (n: number, progress: number | null, status: number | null) => ({
	id: progress === null ? null : 100 + n,
	status,
	progress,
	item: { season_number: n, title: `Season ${n}`, number_of_pages: 10 }
});

beforeEach(() => responses.clear());

describe('getShow progress when episodes were skipped', () => {
	it('counts the ticked episodes of an in-progress season instead of trusting "furthest episode"', async () => {
		responses.set('/api/v1/media/tv/tmdb/270476/', {
			title: "Widow's Bay",
			max_progress: 10,
			consumptions: [{ progress: 10, status: 1 }],
			related: { seasons: [season(1, 10, 1), season(2, null, null)] }
		});
		responses.set('/api/v1/media/tv/tmdb/270476/1/', {
			max_progress: 10,
			related: { episodes: [...Array.from({ length: 9 }, (_, i) => ep(i + 1, 0)), ep(10, 1)] }
		});
		const show = await getShow('tmdb', '270476', { 1: 10, 2: 10 });
		expect(show.seasons[0]).toMatchObject({ seasonNumber: 1, progress: 1, maxProgress: 10 });
		expect(show.progress).toBe(1);
	});

	it('trusts a completed season without fetching it', async () => {
		responses.set('/api/v1/media/tv/tmdb/1/', {
			title: 'Done',
			max_progress: 20,
			consumptions: [{ progress: 15, status: 1 }],
			related: { seasons: [season(1, 10, 3), season(2, 5, 1)] }
		});
		responses.set('/api/v1/media/tv/tmdb/1/2/', {
			max_progress: 10,
			related: { episodes: Array.from({ length: 10 }, (_, i) => ep(i + 1, i < 5 ? 1 : 0)) }
		});
		const show = await getShow('tmdb', '1', { 1: 10, 2: 10 });
		expect(show.seasons.map((s) => s.progress)).toEqual([10, 5]);
		expect(show.progress).toBe(15);
		// Season 1 was never requested (the mock throws on unknown paths).
	});

	it('shows an airing season at its live length, not a stale cheaper count (Below Deck Med 17/18, not 17/17)', async () => {
		// TMDB (the caller's count) still says S11 has 17 episodes; E18 aired, so
		// Floppy's season detail says 18 with 17 watched. The show page must agree
		// with the season page (17/18) rather than render the season complete.
		responses.set('/api/v1/media/tv/tmdb/66902/', {
			title: 'Below Deck Mediterranean',
			max_progress: 192,
			consumptions: [{ progress: 17, status: 1 }],
			related: { seasons: [{ id: 11399, status: 1, progress: 17, item: { season_number: 11, title: 'Season 11', number_of_pages: null } }] }
		});
		responses.set('/api/v1/media/tv/tmdb/66902/11/', {
			max_progress: 18,
			related: { episodes: Array.from({ length: 18 }, (_, i) => ({ progress: i < 17 ? 1 : 0, item: { season_number: 11, episode_number: i + 1 } })) }
		});
		// lastAired still lags at E17 (same stale TMDB source) — the season number is enough.
		const show = await getShow('tmdb', '66902', { 11: 17 }, { season: 11, episode: 17 });
		expect(show.seasons[0]).toMatchObject({ seasonNumber: 11, progress: 17, maxProgress: 18 });
	});

	it("leaves a grouped show's total alone (Re:ZERO: seasons null, total already counts them)", async () => {
		responses.set('/api/v1/media/tv/tmdb/65942/', {
			title: 'Re:ZERO',
			max_progress: 90,
			consumptions: [{ progress: 25, status: 1 }],
			related: { seasons: [season(1, null, null), season(2, null, null)] }
		});
		responses.set('/api/v1/media/tv/tmdb/65942/1/', { max_progress: 25, related: { episodes: Array.from({ length: 25 }, (_, i) => ep(i + 1, 1)) } });
		responses.set('/api/v1/media/tv/tmdb/65942/2/', { max_progress: 25, related: { episodes: Array.from({ length: 25 }, (_, i) => ep(i + 1, 0)) } });
		const show = await getShow('tmdb', '65942', { 1: 25, 2: 25 });
		expect(show.seasons.map((s) => s.progress)).toEqual([25, 0]);
		expect(show.progress).toBe(25);
	});
});
