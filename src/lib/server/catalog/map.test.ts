import { describe, it, expect } from 'vitest';
import { applyAirTimes, mapMovie, mapSeason, mapShow, refreshAfter, seasonsToFetch, type EpisodeRow } from './map';

const NOW = Date.parse('2026-10-09T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describe('mapShow / mapMovie / mapSeason', () => {
	it('turns TMDB show details into a title, its seasons, and the latest aired season', () => {
		const { title, seasons, lastAiredSeason } = mapShow(284833, {
			name: 'Avatar: Seven Havens',
			poster_path: '/p.jpg',
			status: 'Returning Series',
			genres: [{ name: 'Animation' }, { name: 'Family' }],
			networks: [{ name: 'Paramount+' }],
			episode_run_time: [24],
			origin_country: ['US'],
			original_language: 'en',
			first_air_date: '2026-10-08',
			last_episode_to_air: { air_date: '2026-10-08', season_number: 1, episode_number: 3 },
			next_episode_to_air: { air_date: '2026-10-15' },
			seasons: [{ season_number: 0, episode_count: 2 }, { season_number: 1, episode_count: 13 }],
			external_ids: { tvdb_id: 451234, imdb_id: 'tt1234' }
		});
		expect(title).toMatchObject({
			mediaType: 'tv',
			title: 'Avatar: Seven Havens',
			poster: 'https://image.tmdb.org/t/p/w500/p.jpg',
			genres: ['Animation', 'Family'],
			networks: ['Paramount+'],
			runtime: 24,
			lastAirDate: '2026-10-08',
			nextAirDate: '2026-10-15',
			tvdbId: 451234,
			imdbId: 'tt1234'
		});
		expect(seasons).toEqual([{ number: 0, count: 2 }, { number: 1, count: 13 }]);
		expect(lastAiredSeason).toBe(1);
	});

	it('maps a movie, falling back to production countries for its origin', () => {
		const m = mapMovie(603, { title: 'The Matrix', runtime: 136, release_date: '1999-03-31', imdb_id: 'tt0133093', production_countries: [{ iso_3166_1: 'US' }] });
		expect(m).toMatchObject({ mediaType: 'movie', title: 'The Matrix', runtime: 136, releaseDate: '1999-03-31', imdbId: 'tt0133093', originCountry: ['US'] });
	});

	it("maps a season's episodes", () => {
		const eps = mapSeason(1, 2, { episodes: [{ episode_number: 1, name: 'One', air_date: '2026-01-01', runtime: 45, still_path: '/s.jpg' }, { name: 'no number' }] });
		expect(eps).toEqual([{ tmdbId: 1, season: 2, episode: 1, title: 'One', overview: null, still: 'https://image.tmdb.org/t/p/w300/s.jpg', airDate: '2026-01-01', airAt: null, runtime: 45 }]);
	});
});

describe('applyAirTimes', () => {
	const ep = (season: number, episode: number, airDate: string | null): EpisodeRow => ({ tmdbId: 1, season, episode, title: null, overview: null, still: null, airDate, airAt: null, runtime: null });

	it("takes TVmaze's air instant when season, number and date agree (within a day, for time zones)", () => {
		const out = applyAirTimes([ep(1, 1, '2026-10-08'), ep(1, 2, '2026-10-09')], [
			{ season: 1, number: 1, airdate: '2026-10-08', airstamp: '2026-10-09T00:00:00+00:00' },
			{ season: 1, number: 2, airdate: '2026-10-09', airstamp: '2026-10-10T00:00:00+00:00' }
		]);
		expect(out.map((e) => e.airAt)).toEqual(['2026-10-09T00:00:00+00:00', '2026-10-10T00:00:00+00:00']);
	});

	it('ignores a time whose date is far off — the two number differently (anime)', () => {
		const out = applyAirTimes([ep(4, 17, '2026-09-30')], [{ season: 4, number: 17, airdate: '2027-01-01', airstamp: '2027-01-01T15:00:00+00:00' }]);
		expect(out[0].airAt).toBeNull();
	});
});

describe('seasonsToFetch', () => {
	it('fetches new or changed seasons, the current one, and anything after it', () => {
		const stored = new Map([[1, 10], [2, 10], [3, 4]]);
		expect(seasonsToFetch(stored, [{ number: 1, count: 10 }, { number: 2, count: 10 }, { number: 3, count: 8 }, { number: 4, count: 0 }], 3)).toEqual([3, 4]);
		// An ended show with nothing changed fetches nothing beyond its details.
		expect(seasonsToFetch(new Map([[1, 10]]), [{ number: 1, count: 10 }], null)).toEqual([]);
		// First time: everything.
		expect(seasonsToFetch(new Map(), [{ number: 0, count: 2 }, { number: 1, count: 8 }], 1)).toEqual([0, 1]);
	});
});

describe('refreshAfter', () => {
	it('refreshes airing shows hourly, returning ones daily, ended shows and movies weekly', () => {
		const tv = { mediaType: 'tv' as const, status: 'Returning Series', lastAirDate: null, nextAirDate: null };
		expect(refreshAfter({ ...tv, lastAirDate: '2026-10-08' }, NOW)).toBe(NOW + HOUR);
		expect(refreshAfter({ ...tv, nextAirDate: '2026-10-20' }, NOW)).toBe(NOW + HOUR);
		expect(refreshAfter({ ...tv, lastAirDate: '2026-05-01', nextAirDate: '2027-03-01' }, NOW)).toBe(NOW + DAY);
		expect(refreshAfter({ ...tv, status: 'Ended', lastAirDate: '2026-10-08' }, NOW)).toBe(NOW + 7 * DAY);
		expect(refreshAfter({ mediaType: 'movie', status: 'Released', lastAirDate: null, nextAirDate: null }, NOW)).toBe(NOW + 7 * DAY);
	});
});
