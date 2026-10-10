import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const show = vi.fn();
const season = vi.fn();
const movie = vi.fn();
const mazeId = vi.fn();
const mazeEps = vi.fn();
vi.mock('./sources', () => ({
	tmdbShow: (id: number) => show(id),
	tmdbSeason: (id: number, n: number) => season(id, n),
	tmdbMovie: (id: number) => movie(id),
	tvmazeId: (tvdb: number | null, imdb: string | null) => mazeId(tvdb, imdb),
	tvmazeEpisodes: (id: number) => mazeEps(id)
}));
import { openDatabase, useDatabase, db } from '../db';
import { refreshDue, refreshTitle, seedTrackedTitles } from './refresh';
import { catalogStatus, ensureTitle } from './store';

const T0 = Date.parse('2026-10-09T12:00:00Z');
const showJson = (over: Record<string, unknown> = {}) => ({
	name: 'Avatar: Seven Havens',
	status: 'Returning Series',
	last_episode_to_air: { air_date: '2026-10-08', season_number: 1 },
	seasons: [{ season_number: 1, episode_count: 2 }],
	external_ids: { tvdb_id: 99 },
	...over
});
const seasonJson = { episodes: [{ episode_number: 1, name: 'On the Horizon', air_date: '2026-10-08' }, { episode_number: 2, name: 'Into the Storm', air_date: '2026-10-08' }] };

beforeEach(() => {
	useDatabase(openDatabase(':memory:'));
	for (const f of [show, season, movie, mazeId, mazeEps]) f.mockReset();
});
afterEach(() => useDatabase(null));

describe('refreshTitle', () => {
	it('stores a show, its episodes, and TVmaze air times, due again in an hour while airing', async () => {
		show.mockResolvedValue(showJson());
		season.mockResolvedValue(seasonJson);
		mazeId.mockResolvedValue(42);
		mazeEps.mockResolvedValue([{ season: 1, number: 1, airdate: '2026-10-08', airstamp: '2026-10-09T00:00:00+00:00' }]);
		await refreshTitle('tv', 284833, 0, () => T0);

		const t = db().prepare('SELECT title, tvmaze_id, refresh_after FROM titles WHERE tmdb_id = 284833').get() as Record<string, unknown>;
		expect(t).toEqual({ title: 'Avatar: Seven Havens', tvmaze_id: 42, refresh_after: new Date(T0 + 3600_000).toISOString() });
		const eps = db().prepare('SELECT episode, title, air_at FROM episodes WHERE tmdb_id = 284833 ORDER BY episode').all();
		expect(eps).toEqual([
			{ episode: 1, title: 'On the Horizon', air_at: '2026-10-09T00:00:00+00:00' },
			{ episode: 2, title: 'Into the Storm', air_at: null }
		]);
		expect(mazeId).toHaveBeenCalledWith(99, null);
	});

	it('an ended show with nothing changed costs one request next time, and no TVmaze', async () => {
		show.mockResolvedValue(showJson({ status: 'Ended', last_episode_to_air: null }));
		season.mockResolvedValue(seasonJson);
		await refreshTitle('tv', 1, 0, () => T0);
		await refreshTitle('tv', 1, 0, () => T0);
		expect(season).toHaveBeenCalledTimes(1);
		expect(mazeId).not.toHaveBeenCalled();
	});

	it("keeps the dates when TVmaze fails, and records a TMDB failure to retry in an hour", async () => {
		show.mockResolvedValue(showJson());
		season.mockResolvedValue(seasonJson);
		mazeId.mockRejectedValue(new Error('TVmaze down'));
		await refreshTitle('tv', 2, 0, () => T0);
		expect((db().prepare('SELECT COUNT(*) AS n FROM episodes WHERE tmdb_id = 2').get() as { n: number }).n).toBe(2);

		ensureTitle('movie', 3);
		movie.mockRejectedValue(new Error('TMDB /movie/3 → 500'));
		await expect(refreshTitle('movie', 3, 0, () => T0)).rejects.toThrow();
		expect(catalogStatus(T0).failing).toEqual([{ mediaType: 'movie', tmdbId: 3, title: '', error: 'TMDB /movie/3 → 500' }]);
	});
});

describe('seeding and refreshing what is due', () => {
	it('adds what anyone tracks, once, then fills them on the next refresh', async () => {
		const track = db().prepare("INSERT INTO tracked (user_id, media_type, tmdb_id, status, added_at, updated_at) VALUES (?, ?, ?, 1, 'x', 'x')");
		db().exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
		for (const u of [1, 2]) db().prepare("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (?, 1, ?, 'A', 'owner', 'h', 'x')").run(u, `${u}@x`);
		track.run(1, 'tv', 284833);
		track.run(2, 'tv', 284833); // shared: one title
		track.run(1, 'movie', 284833);
		expect(await seedTrackedTitles()).toBe(2);
		expect(await seedTrackedTitles()).toBe(0);
		show.mockResolvedValue(showJson());
		season.mockResolvedValue(seasonJson);
		movie.mockResolvedValue({ title: 'Something' });
		mazeId.mockResolvedValue(null);
		const r = await refreshDue(10, 0);
		expect(r).toEqual({ refreshed: 2, failed: 0 });
		expect(catalogStatus(Date.now())).toMatchObject({ shows: 1, movies: 1, filled: 2, episodes: 2, due: 0 });
	});
});
