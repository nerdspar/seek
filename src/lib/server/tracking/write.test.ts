import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase, db } from '../db';
import { afterUnplay, clearSeason, fillSeason, recordPlay, removeNewestPlay, settleCompletion, setTracked, Status, untrack } from './write';

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

describe('status follows what you watch', () => {
	const NOW = Date.parse('2026-10-09T00:00:00Z');
	beforeEach(() => {
		db().exec("INSERT INTO titles (media_type, tmdb_id, title, status, refresh_after) VALUES ('tv', 10, 'Done', 'Ended', 'x'), ('tv', 11, 'Running', 'Returning Series', 'x')");
		const ins = db().prepare('INSERT INTO episodes (tmdb_id, season, episode, air_date) VALUES (?, ?, ?, ?)');
		for (const id of [10, 11]) {
			ins.run(id, 0, 1, '2025-01-01'); // a special: never needed
			ins.run(id, 1, 1, '2026-01-01');
			ins.run(id, 1, 2, '2026-01-08');
		}
	});

	it('an ended show becomes Completed once every aired episode is watched', () => {
		recordPlay(1, 'tv', 10, 1, 1);
		settleCompletion(1, 10, NOW);
		expect(status(10)).toBe(Status.Watching);
		recordPlay(1, 'tv', 10, 1, 2);
		settleCompletion(1, 10, NOW);
		expect(status(10)).toBe(Status.Completed);
	});

	it('a show still running stays Watching when caught up; Paused or Dropped is left alone', () => {
		recordPlay(1, 'tv', 11, 1, 1);
		recordPlay(1, 'tv', 11, 1, 2);
		settleCompletion(1, 11, NOW);
		expect(status(11)).toBe(Status.Watching);
		setTracked(1, 'tv', 10, { status: Status.Dropped });
		recordPlay(1, 'tv', 10, 1, 1);
		recordPlay(1, 'tv', 10, 1, 2);
		settleCompletion(1, 10, NOW);
		expect(status(10)).toBe(Status.Dropped);
	});

	it('unmarking reopens a Completed show, but not over one remaining play of a rewatch', () => {
		recordPlay(1, 'tv', 10, 1, 1);
		recordPlay(1, 'tv', 10, 1, 2);
		recordPlay(1, 'tv', 10, 1, 2);
		setTracked(1, 'tv', 10, { status: Status.Completed });
		removeNewestPlay(1, 'tv', 10, 1, 2);
		afterUnplay(1, 'tv', 10, 1, 2);
		expect(status(10)).toBe(Status.Completed);
		removeNewestPlay(1, 'tv', 10, 1, 2);
		afterUnplay(1, 'tv', 10, 1, 2);
		expect(status(10)).toBe(Status.Watching);
	});

	it('a film with no plays left goes back to Planning', () => {
		recordPlay(1, 'movie', 603, null, null);
		removeNewestPlay(1, 'movie', 603, null, null);
		afterUnplay(1, 'movie', 603, null, null);
		expect(status(603)).toBe(Status.Planning);
	});
});
