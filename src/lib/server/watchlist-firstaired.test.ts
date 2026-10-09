import { describe, it, expect, vi, beforeEach } from 'vitest';

const responses = new Map<string, unknown>();
vi.mock('./floppy', () => ({
	floppy: async (path: string) => {
		if (!responses.has(path)) throw new Error(`unexpected ${path}`);
		return responses.get(path);
	}
}));

import { firstAiredFor } from './watchlist';

const NOW = Date.parse('2026-10-09T12:00:00-04:00');
const ep = (n: number, air: string | null, plays = 0) => ({ progress: plays, item: { episode_number: n, release_datetime: air } });

beforeEach(() => responses.clear());

describe('firstAiredFor (a just-added show whose premiere already aired)', () => {
	it('finds the first aired episode when Floppy still says nothing is next (Avatar: Seven Havens)', async () => {
		responses.set('/api/v1/media/tv/tmdb/284833/', { related: { seasons: [{ item: { season_number: 0 } }, { item: { season_number: 1 } }] } });
		responses.set('/api/v1/media/tv/tmdb/284833/1/', {
			related: {
				episodes: [
					ep(1, '2026-10-08T20:00:00-04:00'),
					ep(2, '2026-10-08T20:00:00-04:00'),
					ep(4, '2026-10-15T20:00:00-04:00')
				]
			}
		});
		expect(await firstAiredFor('tmdb', '284833', NOW)).toEqual({ season: 1, episode: 1, airDate: '2026-10-08T20:00:00-04:00' });
	});

	it('stays empty when nothing has aired yet, so the show waits for its premiere', async () => {
		responses.set('/api/v1/media/tv/tmdb/9/', { related: { seasons: [{ item: { season_number: 1 } }] } });
		responses.set('/api/v1/media/tv/tmdb/9/1/', { related: { episodes: [ep(1, '2026-10-15T20:00:00-04:00'), ep(2, null)] } });
		expect(await firstAiredFor('tmdb', '9', NOW)).toBeNull();
	});
});
