import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase, db } from './db';
import { runAs } from './userctx';
import type { User } from './users';
import { getWatchlist, getRow, knownServices, getRecentlyAdded, episodeTitle } from './watchlist';

const me: User = { id: 1, householdId: 1, email: 'a@x', name: 'A', role: 'owner', sessionVersion: 1, emailVerified: true };
const as = <T>(fn: () => T) => runAs(me, fn);

function show(id: number, title: string, opts: { genres?: string[]; origin?: string[]; services?: string[] } = {}) {
	db()
		.prepare(
			"INSERT INTO titles (media_type, tmdb_id, title, genres, origin_country, services, refreshed_at, refresh_after) VALUES ('tv', ?, ?, ?, ?, ?, 'x', 'x')"
		)
		.run(id, title, JSON.stringify(opts.genres ?? ['Drama']), JSON.stringify(opts.origin ?? ['US']), JSON.stringify(opts.services ?? []));
	const ins = db().prepare('INSERT INTO episodes (tmdb_id, season, episode, title, air_date) VALUES (?, 1, ?, ?, ?)');
	ins.run(id, 1, 'Pilot', '2020-01-01');
	ins.run(id, 2, 'Second', '2020-01-08');
	db().prepare("INSERT INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, created_at) VALUES (1, 'tv', ?, 1, 1, ?, 'import', 'x')").run(id, `2026-0${id}-01T00:00:00Z`);
	db().prepare("INSERT INTO tracked (user_id, media_type, tmdb_id, status, added_at, updated_at) VALUES (1, 'tv', ?, 1, ?, ?)").run(id, `2025-0${id}-01T00:00:00Z`, `2025-0${id}-01T00:00:00Z`);
}

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x')");
	useDatabase(d);
	show(1, 'Lanterns', { services: ['HBO Max', 'HBO Max Amazon Channel'] });
	show(2, 'Re:ZERO', { genres: ['Animation'], origin: ['JP'], services: ['Crunchyroll'] });
	show(3, 'Slow Horses', { services: ['Apple TV+'] });
});
afterEach(() => useDatabase(null));

describe('watchlist from Seek', () => {
	it('pages the backlog and reports whether more is left', async () => {
		const first = await as(() => getWatchlist('tv', { limit: 2 }));
		expect(first.rows.map((r) => r.title)).toEqual(['Slow Horses', 'Re:ZERO']);
		expect([first.total, first.hasMore]).toEqual([3, true]);
		const rest = await as(() => getWatchlist('tv', { limit: 2, offset: 2 }));
		expect([rest.rows.map((r) => r.title), rest.hasMore]).toEqual([['Lanterns'], false]);
	});

	it('"anime" as a type is the shows with the anime flag', async () => {
		expect((await as(() => getWatchlist('anime'))).rows.map((r) => r.title)).toEqual(['Re:ZERO']);
	});

	it('answers one row, an episode title, the services and the latest additions', async () => {
		expect((await as(() => getRow('tv', 'tmdb', '1')))?.title).toBe('Lanterns');
		expect(await as(() => getRow('tv', 'tmdb', '99'))).toBeNull();
		expect(await episodeTitle('tmdb', '1', 1, 2)).toBe('Second');
		expect(await as(() => knownServices())).toEqual(['Apple TV+', 'Crunchyroll', 'HBO Max']);
		expect((await as(() => getRecentlyAdded(2))).map((r) => r.title)).toEqual(['Slow Horses', 'Re:ZERO']);
	});

	it('is empty with nobody signed in', async () => {
		expect(await getWatchlist('tv')).toEqual({ rows: [], total: 0, hasMore: false });
	});
});
