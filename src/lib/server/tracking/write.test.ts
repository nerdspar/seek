import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase, db } from '../db';
import { clearSeason, fillSeason, recordPlay, removeNewestPlay, setTracked, Status, untrack } from './write';
import { syncImportedPlays } from './store';

const plays = (where = '1=1') =>
	db().prepare(`SELECT season, episode, source, external_key FROM plays WHERE ${where} ORDER BY season, episode, id`).all();
const status = (id: number) => (db().prepare('SELECT status FROM tracked WHERE tmdb_id = ?').get(id) as { status: number } | undefined)?.status;

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x')");
	useDatabase(d);
});
afterEach(() => useDatabase(null));

describe("Seek's own record of each change", () => {
	it('a play moves a planned show to Watching; undo removes only the newest play', () => {
		setTracked(1, 'tv', 10, { status: Status.Planning });
		recordPlay(1, 'tv', 10, 1, 1, '2026-10-01T00:00:00Z');
		recordPlay(1, 'tv', 10, 1, 1, '2026-10-05T00:00:00Z'); // a rewatch
		expect(status(10)).toBe(Status.Watching);
		expect(removeNewestPlay(1, 'tv', 10, 1, 1)).toBe(true);
		expect(db().prepare('SELECT watched_at FROM plays').all()).toEqual([{ watched_at: '2026-10-01T00:00:00Z' }]);
	});

	it('a film played or set Completed is tracked; removing a title takes its plays with it', () => {
		recordPlay(1, 'movie', 603, null, null);
		expect(status(603)).toBe(Status.Completed);
		untrack(1, 'movie', 603);
		expect(plays()).toEqual([]);
		expect(status(603)).toBeUndefined();
	});

	it('a season fill marks the next aired episodes with no play, like Floppy', () => {
		const ins = db().prepare('INSERT INTO episodes (tmdb_id, season, episode, air_date) VALUES (10, 1, ?, ?)');
		[1, 2, 3, 4].forEach((e) => ins.run(e, '2026-01-01'));
		ins.run(5, '2099-01-01'); // not aired
		recordPlay(1, 'tv', 10, 1, 2);
		expect(fillSeason(1, 10, 1, 10, Date.parse('2026-10-09T00:00:00Z'))).toBe(3);
		expect((plays() as { episode: number }[]).map((p) => p.episode)).toEqual([1, 2, 3, 4]);
		clearSeason(1, 10, 1);
		expect(plays()).toEqual([]);
	});
});

describe('the nightly copy and plays Seek recorded itself', () => {
	const floppyPlay = (key: string, e: number, at: string) => ({ mediaType: 'tv' as const, tmdbId: 10, season: 1, episode: e, watchedAt: at, externalKey: key });

	it("links a mark made in Seek to Floppy's copy of the same viewing instead of copying it twice", () => {
		recordPlay(1, 'tv', 10, 1, 1, '2026-10-09T20:00:00Z');
		const r = syncImportedPlays(1, 'tv', [floppyPlay('floppy:episode:1', 1, '2026-10-09T20:00:03Z')], '2099-01-01T00:00:00Z');
		expect(r).toEqual({ added: 0, removed: 0, linked: 1 });
		expect(plays()).toEqual([{ season: 1, episode: 1, source: 'seek', external_key: 'floppy:episode:1' }]);
	});

	it("drops a Seek play Floppy never got, but keeps one recorded during the run", () => {
		recordPlay(1, 'tv', 10, 1, 1, '2026-10-01T00:00:00Z');
		const runStart = new Date(Date.now() + 1000).toISOString();
		const r = syncImportedPlays(1, 'tv', [], runStart);
		expect(r.removed).toBe(1);
		recordPlay(1, 'tv', 10, 1, 2);
		syncImportedPlays(1, 'tv', [], '2000-01-01T00:00:00Z');
		expect((plays() as { episode: number }[]).map((p) => p.episode)).toEqual([2]);
	});

	it('a linked play unmarked in Floppy goes on the next copy', () => {
		recordPlay(1, 'tv', 10, 1, 1, '2026-10-09T20:00:00Z');
		syncImportedPlays(1, 'tv', [floppyPlay('floppy:episode:1', 1, '2026-10-09T20:00:00Z')], '2099-01-01T00:00:00Z');
		expect(syncImportedPlays(1, 'tv', [], '2099-01-01T00:00:00Z').removed).toBe(1);
	});
});
