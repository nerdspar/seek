import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase, db } from '../db';
import { seekList } from './read';

const NOW = Date.parse('2026-10-09T22:00:00Z');

function show(id: number, title: string, opts: { genres?: string[]; origin?: string[]; services?: string[]; eps: [number, number, string][] }) {
	db()
		.prepare(
			"INSERT INTO titles (media_type, tmdb_id, title, genres, origin_country, services, refreshed_at, refresh_after) VALUES ('tv', ?, ?, ?, ?, ?, 'x', 'x')"
		)
		.run(id, title, JSON.stringify(opts.genres ?? ['Drama']), JSON.stringify(opts.origin ?? ['US']), JSON.stringify(opts.services ?? []));
	const ins = db().prepare('INSERT INTO episodes (tmdb_id, season, episode, title, air_date) VALUES (?, ?, ?, ?, ?)');
	for (const [s, e, date] of opts.eps) ins.run(id, s, e, `Ep ${e}`, date);
}
const track = (id: number, status = 1, added = '2026-01-01T00:00:00Z', kind = 'tv') =>
	db().prepare('INSERT INTO tracked (user_id, media_type, tmdb_id, status, added_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)').run(kind, id, status, added, added);
const play = (id: number, s: number | null, e: number | null, at: string, kind = 'tv') =>
	db().prepare("INSERT INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, created_at) VALUES (1, ?, ?, ?, ?, ?, 'import', 'x')").run(kind, id, s, e, at);

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x')");
	useDatabase(d);
	show(1, 'Lanterns', { services: ['HBO Max'], eps: [[1, 1, '2026-08-17'], [1, 2, '2026-08-24'], [1, 3, '2026-12-01']] });
	show(2, 'Re:ZERO', { genres: ['Animation'], origin: ['JP'], eps: [[1, 1, '2016-04-04'], [1, 2, '2016-04-11']] });
	show(3, 'Done', { eps: [[1, 1, '2020-01-01']] });
	track(1);
	track(2);
	track(3, 3);
	play(1, 1, 1, '2026-09-01T00:00:00Z');
	play(2, 1, 1, '2026-10-01T00:00:00Z');
	play(3, 1, 1, '2020-02-01T00:00:00Z');
});
afterEach(() => useDatabase(null));

describe('seekList', () => {
	it('the in-progress backlog: next-up with its title, progress, most recently active first', () => {
		const page = seekList(1, 1, 'tv', {}, NOW);
		expect(page.rows.map((r) => [r.title, r.next?.episode, r.next?.title, r.progress, r.maxProgress, r.left])).toEqual([
			['Re:ZERO', 2, 'Ep 2', 1, 2, 1],
			['Lanterns', 2, 'Ep 2', 1, 3, 2]
		]);
	});

	it('splits shows and anime, and filters by service and company', () => {
		expect(seekList(1, 1, 'tv', { tag: 'anime' }, NOW).rows.map((r) => r.title)).toEqual(['Re:ZERO']);
		expect(seekList(1, 1, 'tv', { tag: 'anime', tagMode: 'not' }, NOW).rows.map((r) => r.title)).toEqual(['Lanterns']);
		expect(seekList(1, 1, 'tv', { services: ['HBO Max'] }, NOW).rows.map((r) => r.title)).toEqual(['Lanterns']);
		db().exec("INSERT INTO shared_shows (household_id, media_type, source, media_id, created_at) VALUES (1, 'tv', 'tmdb', '1', 'x')");
		expect(seekList(1, 1, 'tv', { company: 'joint' }, NOW).rows.map((r) => r.title)).toEqual(['Lanterns']);
		expect(seekList(1, 1, 'tv', { company: 'solo' }, NOW).rows.map((r) => r.title)).toEqual(['Re:ZERO']);
	});

	it('a household override wins over the anime rule', () => {
		db().exec("INSERT INTO anime_overrides (household_id, source, media_id, is_anime, user_id, created_at) VALUES (1, 'tmdb', '2', 0, 1, 'x')");
		expect(seekList(1, 1, 'tv', { tag: 'anime' }, NOW).rows).toEqual([]);
	});

	it('library views: every status, sorted by title (articles ignored), finished shows kept', () => {
		db().prepare("UPDATE titles SET title = 'The Lanterns' WHERE tmdb_id = 1").run();
		const all = seekList(1, 1, 'tv', { statuses: ['all'], sort: 'title', direction: 'asc' }, NOW);
		expect(all.rows.map((r) => r.title)).toEqual(['Done', 'The Lanterns', 'Re:ZERO']);
		expect(seekList(1, 1, 'tv', { statuses: ['completed'] }, NOW).rows.map((r) => r.title)).toEqual(['Done']);
	});

	it('films: watched or not, never dropped from the backlog for having no next episode', () => {
		db().exec("INSERT INTO titles (media_type, tmdb_id, title, refresh_after) VALUES ('movie', 603, 'The Matrix', 'x')");
		track(603, 0, '2026-01-01T00:00:00Z', 'movie');
		expect(seekList(1, 1, 'movie', { statuses: ['planning'] }, NOW).rows).toMatchObject([{ title: 'The Matrix', progress: 0, maxProgress: 1 }]);
		play(603, null, null, '2026-10-01T00:00:00Z', 'movie');
		expect(seekList(1, 1, 'movie', { statuses: ['all'] }, NOW).rows[0]).toMatchObject({ progress: 1, left: 0 });
	});
});
