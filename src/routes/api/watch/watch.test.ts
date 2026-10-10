import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/server/catalog/refresh', () => ({ refreshTitle: async () => {} }));

import { openDatabase, useDatabase, db } from '$lib/server/db';
import { runAs } from '$lib/server/userctx';
import { share } from '$lib/server/household/shared';
import type { User } from '$lib/server/users';
import { POST, DELETE } from './+server';
import { POST as fillSeason, DELETE as clearSeason } from '../season/+server';
import { POST as add, DELETE as remove } from '../library/+server';
import { GET as history, DELETE as removeOne } from '../plays/+server';

const me: User = { id: 1, householdId: 1, email: 'a@x', name: 'A', role: 'owner', sessionVersion: 1, emailVerified: true };
const call = (handler: (e: never) => Response | Promise<Response>, body: unknown, key?: string) =>
	runAs(me, async () =>
		handler({ request: new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: key ? { 'Idempotency-Key': key } : {} }) } as never)
	);
const playsOf = (userId: number) =>
	(db().prepare('SELECT season, episode FROM plays WHERE user_id = ? ORDER BY season, episode, id').all(userId) as { season: number; episode: number }[]).map(
		(p) => `S${p.season}E${p.episode}`
	);

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x'), (2, 1, 'b@x', 'B', 'member', 'h', 'x')");
	d.exec("INSERT INTO titles (media_type, tmdb_id, title, status, refreshed_at, refresh_after) VALUES ('tv', 10, 'Lanterns', 'Ended', 'x', 'x')");
	const ins = d.prepare("INSERT INTO episodes (tmdb_id, season, episode, title, air_date) VALUES (10, 1, ?, ?, '2026-01-01')");
	[1, 2, 3].forEach((e) => ins.run(e, `Ep ${e}`));
	useDatabase(d);
});
afterEach(() => useDatabase(null));

describe('marking episodes', () => {
	it('records a play and answers with the updated row', async () => {
		const res = await (await call(POST, { mediaId: '10', season: 1, episode: 1 })).json();
		expect(playsOf(1)).toEqual(['S1E1']);
		expect(res.row).toMatchObject({ title: 'Lanterns', progress: 1, next: { season: 1, episode: 2 } });
	});

	it('a replayed request (same key) records nothing more', async () => {
		await call(POST, { mediaId: '10', season: 1, episode: 1 }, 'k1');
		await call(POST, { mediaId: '10', season: 1, episode: 1 }, 'k1');
		expect(playsOf(1)).toEqual(['S1E1']);
	});

	it('"Watched on…" keeps the date given, and refuses one in the future', async () => {
		await call(POST, { mediaId: '10', season: 1, episode: 1, at: '2026-09-01T20:00:00Z' });
		expect(db().prepare('SELECT watched_at FROM plays').get()).toEqual({ watched_at: '2026-09-01T20:00:00.000Z' });
		await expect(call(POST, { mediaId: '10', season: 1, episode: 2, at: '2999-01-01' })).rejects.toMatchObject({ status: 400 });
	});

	it('a shared show counts for both; an unmark is yours alone', async () => {
		share(1, 1, { source: 'tmdb', mediaId: '10' });
		await call(POST, { mediaId: '10', season: 1, episode: 1 });
		expect([playsOf(1), playsOf(2)]).toEqual([['S1E1'], ['S1E1']]);
		await call(DELETE, { mediaId: '10', season: 1, episode: 1 });
		expect([playsOf(1), playsOf(2)]).toEqual([[], ['S1E1']]);
	});

	it('only TMDB titles', async () => {
		await expect(call(POST, { source: 'tvdb', mediaId: '10', season: 1, episode: 1 })).rejects.toMatchObject({ status: 400 });
	});
});

describe('whole seasons', () => {
	it('fills every aired episode not yet seen, completes an ended show, and clears', async () => {
		await call(POST, { mediaId: '10', season: 1, episode: 2 });
		expect(await (await call(fillSeason, { mediaId: '10', season: 1 })).json()).toMatchObject({ marked: 2 });
		expect(playsOf(1)).toEqual(['S1E1', 'S1E2', 'S1E3']);
		expect(db().prepare('SELECT status FROM tracked WHERE user_id = 1').get()).toEqual({ status: 3 });
		await call(clearSeason, { mediaId: '10', season: 1 });
		expect(playsOf(1)).toEqual([]);
		expect(db().prepare('SELECT status FROM tracked WHERE user_id = 1').get()).toEqual({ status: 1 });
	});
});

describe('adding and removing', () => {
	it('adds as Planning, says when it was already there, and removes with its plays', async () => {
		expect(await (await call(add, { mediaId: '10', title: 'Lanterns' })).json()).toMatchObject({ ok: true });
		expect(db().prepare('SELECT status FROM tracked WHERE user_id = 1').get()).toEqual({ status: 0 });
		expect(await (await call(add, { mediaId: '10' })).json()).toMatchObject({ alreadyTracked: true });
		await call(POST, { mediaId: '10', season: 1, episode: 1 });
		await call(remove, { mediaId: '10' });
		expect(db().prepare('SELECT COUNT(*) AS n FROM tracked').get()).toEqual({ n: 0 });
		expect(playsOf(1)).toEqual([]);
	});
});

describe('rewatches', () => {
	const get = (q: string) => runAs(me, async () => (await history({ url: new URL(`http://x/api/plays?${q}`) } as never)).json());

	it('lists the history, removes one play, and rewatches a whole season on a given day', async () => {
		await call(POST, { mediaId: '10', season: 1, episode: 1, at: '2026-02-01T20:00:00Z' });
		await call(POST, { mediaId: '10', season: 1, episode: 1, at: '2026-09-01T20:00:00Z' });
		const { plays } = await get('mediaId=10&season=1&episode=1');
		expect(plays.map((p: { watchedAt: string }) => p.watchedAt)).toEqual(['2026-09-01T20:00:00.000Z', '2026-02-01T20:00:00.000Z']);

		await call(removeOne, { id: plays[1].id });
		expect(playsOf(1)).toEqual(['S1E1']);

		expect(await (await call(fillSeason, { mediaId: '10', season: 1, rewatch: true, at: '2026-10-01T20:00:00Z' })).json()).toMatchObject({ marked: 3 });
		expect(playsOf(1)).toEqual(['S1E1', 'S1E1', 'S1E2', 'S1E3']);
		expect((await get('mediaId=10&season=1')).plays).toHaveLength(4);
	});

	it('refuses a season date in the future, and someone else\'s play', async () => {
		await expect(call(fillSeason, { mediaId: '10', season: 1, rewatch: true, at: '2999-01-01' })).rejects.toMatchObject({ status: 400 });
		db().exec("INSERT INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, created_at) VALUES (2, 'tv', 10, 1, 1, 'x', 'seek', 'x')");
		const theirs = (db().prepare('SELECT id FROM plays WHERE user_id = 2').get() as { id: number }).id;
		await expect(call(removeOne, { id: theirs })).rejects.toMatchObject({ status: 404 });
	});
});
