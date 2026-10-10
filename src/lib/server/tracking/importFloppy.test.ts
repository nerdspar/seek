import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* A fake Floppy: lists and history pages, keyed by path + media type. */
let lists: Record<string, unknown[]> = {};
let history: Record<string, unknown[]> = {};
vi.mock('../floppy', () => ({
	floppy: async (path: string, opts: { query: Record<string, string> }) => {
		const q = opts.query;
		const all = path.startsWith('/api/v1/history/') ? (history[q.media_type] ?? []) : (lists[path] ?? []);
		const offset = Number(q.offset);
		const results = all.slice(offset, offset + Number(q.limit));
		return { results, pagination: { total: all.length, next: offset + results.length < all.length ? 'more' : null } };
	}
}));
vi.mock('../userctx', async (orig) => ({ ...(await orig<object>()), currentUser: () => ({ id: 1, householdId: 1 }) }));

import { openDatabase, useDatabase, db } from '../db';
import { copyFromFloppy } from './importFloppy';
import { lastRun, reviewsFor } from './store';

const listRow = (id: number, status = 1) => ({ item: { source: 'tmdb', media_id: String(id) }, status, created_at: '2026-01-01T00:00:00Z' });
const ep = (instance: number, show: number, s: number, e: number) => ({
	media_type: 'episode',
	item: { source: 'tmdb', media_id: String(show) },
	season_number: s,
	episode_number: e,
	played_at_local: `2026-10-0${(instance % 9) + 1}T20:00:00-04:00`,
	instance_id: instance
});

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x')");
	useDatabase(d);
	lists = { '/api/v1/media/tv/': [listRow(65942), listRow(95350, 3)], '/api/v1/media/movie/': [listRow(603, 3)] };
	// 450 episode plays: more than two pages, so paging is exercised.
	history = {
		tv: Array.from({ length: 450 }, (_, i) => ep(i + 1, i % 2 ? 65942 : 95350, 1, (i % 85) + 1)),
		movie: [{ media_type: 'movie', item: { source: 'tmdb', media_id: '603' }, played_at_local: '2026-05-09T13:08:00-04:00', instance_id: 7 }]
	};
});
afterEach(() => useDatabase(null));

describe('copyFromFloppy', () => {
	it('copies tracked titles and every play, and says the totals match', async () => {
		const s = await copyFromFloppy();
		expect(s.tracked).toEqual({ tv: 2, movie: 1 });
		expect(s.plays).toEqual({ tv: { floppy: 450, seek: 450, skipped: 0 }, movie: { floppy: 1, seek: 1, skipped: 0 } });
		// Show info isn't fetched yet in this test, so the episode check waits rather than flagging.
		expect(s.pendingCatalog).toBe(450);
		expect(s.matches).toBe(true);
		expect(lastRun(1)?.added).toBe(454); // 3 titles + 451 plays
		expect((db().prepare("SELECT status FROM tracked WHERE tmdb_id = 95350").get() as { status: number }).status).toBe(3);
	});

	it('is add-only: nothing twice, and what Seek changed since stays as Seek has it', async () => {
		await copyFromFloppy();
		db().exec('UPDATE tracked SET status = 2 WHERE tmdb_id = 95350');
		db().exec('DELETE FROM plays WHERE id = (SELECT MIN(id) FROM plays)');
		history.tv = history.tv.slice(1);
		lists['/api/v1/media/tv/'] = [listRow(65942)];
		const s = await copyFromFloppy();
		expect([s.added, s.removed]).toEqual([0, 0]);
		expect((db().prepare('SELECT status FROM tracked WHERE tmdb_id = 95350').get() as { status: number }).status).toBe(2);
		expect((db().prepare("SELECT COUNT(*) AS n FROM plays WHERE media_type = 'tv'").get() as { n: number }).n).toBe(449);
	});

	it('a catch-up reads only back to `since`, and links a viewing Seek already has', async () => {
		const newest = { ...ep(1001, 95350, 1, 2), played_at_local: '2026-10-09T21:00:00-04:00' };
		history.tv = [newest, ...history.tv.map((p) => ({ ...(p as object), played_at_local: '2026-01-01T20:00:00-04:00' }))];
		db().exec("INSERT INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, created_at) VALUES (1, 'tv', 95350, 1, 2, '2026-10-10T01:05:00Z', 'jellyfin', 'x')");
		const s = await copyFromFloppy('2026-10-01T00:00:00Z');
		expect(s.added).toBe(3); // the three tracked titles; the play was linked
		expect((db().prepare("SELECT external_key FROM plays WHERE source = 'jellyfin'").get() as { external_key: string }).external_key).toMatch(/^floppy:/);
		expect((db().prepare("SELECT COUNT(*) AS n FROM plays WHERE media_type = 'tv'").get() as { n: number }).n).toBe(1);
		expect(s.matches).toBe(false);
	});

	it('lists what it could not take, and flags a play on an episode TMDB doesn’t have', async () => {
		history.tv.push({ media_type: 'episode', item: { source: 'tvdb', media_id: '5' }, season_number: 1, episode_number: 1, played_at_local: '2026-01-01T00:00:00Z', instance_id: 9999 });
		db().exec("INSERT INTO titles (media_type, tmdb_id, title, refreshed_at, refresh_after) VALUES ('tv', 65942, 'Re:ZERO', 'x', 'x')");
		db().exec("INSERT INTO episodes (tmdb_id, season, episode) VALUES (65942, 1, 1)");
		const s = await copyFromFloppy();
		expect(s.matches).toBe(false);
		const reasons = reviewsFor(1, 500).map((r) => r.reason);
		expect(reasons).toContain('not-tmdb');
		expect(reasons).toContain('episode-not-in-tmdb');
		expect(s.plays.tv.skipped).toBe(1);
	});
});
