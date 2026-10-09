import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../catalog/refresh', () => ({ refreshTitle: async () => {} }));
vi.mock('../tmdb', () => ({
	tmdb: async () => ({ parts: [{ id: 2, title: 'Part Two', release_date: '2002-01-01' }, { id: 1, title: 'Part One', release_date: '2001-01-01' }] })
}));
import { openDatabase, useDatabase, db } from '../db';
import { seekEpisode, seekMovie, seekSeason, seekShow, seekTracking } from './detail';

const NOW = Date.parse('2026-10-09T22:00:00Z');

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x')");
	useDatabase(d);
	d.prepare(
		`INSERT INTO titles (media_type, tmdb_id, title, overview, vote, vote_count, genres, companies, cast_json, seasons_json, status, refreshed_at, refresh_after)
		VALUES ('tv', 66902, 'Below Deck Mediterranean', 'Yachts.', 7.7, 120, '["Reality"]', '["Bravo"]', ?, ?, 'Returning Series', 'x', 'x')`
	).run(JSON.stringify([{ name: 'Sandy Yawn', role: 'Self', image: null }]), JSON.stringify([{ number: 11, name: 'Season 11', poster: '/p.jpg', count: 18 }]));
	const ins = d.prepare('INSERT INTO episodes (tmdb_id, season, episode, title, air_date) VALUES (66902, 11, ?, ?, ?)');
	for (let e = 1; e <= 18; e++) ins.run(e, `Ep ${e}`, e === 18 ? '2026-10-06' : '2026-06-01');
	ins.run(19, 'Ep 19', '2026-10-13');
	const play = d.prepare("INSERT INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, created_at) VALUES (1, 'tv', 66902, 11, ?, '2026-09-01T00:00:00Z', 'import', 'x')");
	for (let e = 1; e <= 17; e++) play.run(e);
	play.run(17); // a rewatch
	d.exec("INSERT INTO tracked (user_id, media_type, tmdb_id, status, score, added_at, updated_at) VALUES (1, 'tv', 66902, 1, 8, 'x', 'x')");
});
afterEach(() => useDatabase(null));

describe('show, season and episode pages from Seek', () => {
	it("counts a season against everything TMDB lists, and aired separately (Below Deck Med 17/19, 18 aired)", async () => {
		const show = await seekShow(1, 66902, NOW);
		expect(show).toMatchObject({ title: 'Below Deck Mediterranean', synopsis: 'Yachts.', score: 7.7, studios: ['Bravo'], tracked: true, progress: 17, maxProgress: 19 });
		expect(show?.seasons).toEqual([{ seasonNumber: 11, title: 'Season 11', poster: '/p.jpg', progress: 17, maxProgress: 19, airedMax: 18, tracked: true }]);
	});

	it("lists a season's episodes with their play counts (2 = rewatched)", async () => {
		const s = await seekSeason(1, 66902, 11);
		expect(s?.progress).toBe(17);
		expect(s?.episodes.find((e) => e.episodeNumber === 17)?.plays).toBe(2);
		expect(s?.episodes.find((e) => e.episodeNumber === 18)).toMatchObject({ plays: 0, airDate: '2026-10-06T00:00:00Z' });
		expect(await seekEpisode(1, 66902, 11, 18)).toMatchObject({ title: 'Ep 18', showTitle: 'Below Deck Mediterranean', plays: 0 });
	});

	it('your status and rating; untracked when you have none', () => {
		expect(seekTracking(1, 'tv', 66902)).toEqual({ tracked: true, status: 1, score: 8, floppyPath: null });
		expect(seekTracking(1, 'movie', 603).tracked).toBe(false);
	});
});

describe('film pages from Seek', () => {
	it('watched means a play is on record; the collection comes in release order', async () => {
		db().exec(
			`INSERT INTO titles (media_type, tmdb_id, title, runtime, collection_json, refreshed_at, refresh_after) VALUES ('movie', 1, 'Part One', 100, '{"id":9,"name":"The Parts"}', 'x', 'x')`
		);
		expect(await seekMovie(1, 1)).toMatchObject({ watched: false, progress: 0, collection: { name: 'The Parts', items: [{ title: 'Part One' }, { title: 'Part Two' }] } });
		db().exec("INSERT INTO plays (user_id, media_type, tmdb_id, watched_at, source, created_at) VALUES (1, 'movie', 1, 'x', 'seek', 'x')");
		expect(await seekMovie(1, 1)).toMatchObject({ watched: true, progress: 1 });
	});
});
