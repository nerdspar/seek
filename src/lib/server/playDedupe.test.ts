import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, dedupeImportedPlays, backupBeforeMigrating, MIGRATIONS, type DB } from './db';

let d: DB;
afterEach(() => d?.close());

function seed() {
	d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x'), (2, 1, 'b@x', 'B', 'member', 'h', 'x')");
	return d.prepare("INSERT INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x')");
}
const left = () => (d.prepare('SELECT user_id, season, episode, watched_at, source FROM plays ORDER BY user_id, season, episode, watched_at').all() as { watched_at: string }[]);

describe('dedupeImportedPlays', () => {
	it('keeps the first play of a viewing logged at its start and end (Re:Zero E10/E11)', () => {
		const ins = seed();
		ins.run(1, 'tv', 65942, 1, 10, '2026-04-11T19:12:00.000Z', 'import');
		ins.run(1, 'tv', 65942, 1, 10, '2026-04-11T19:38:00.000Z', 'import');
		ins.run(1, 'tv', 65942, 1, 11, '2026-04-11T19:38:00.000Z', 'import');
		ins.run(1, 'tv', 65942, 1, 11, '2026-04-11T20:03:00.000Z', 'import');
		expect(dedupeImportedPlays(d, 24 * 3600_000)).toHaveLength(2);
		expect(left().map((p) => p.watched_at)).toEqual(['2026-04-11T19:12:00.000Z', '2026-04-11T19:38:00.000Z']);
	});

	it('counts the window from the play kept, so a real rewatch days later stays', () => {
		const ins = seed();
		ins.run(1, 'tv', 1, 1, 1, '2026-04-10T22:30:00.000Z', 'import');
		ins.run(1, 'tv', 1, 1, 1, '2026-04-11T11:33:00.000Z', 'import'); // next morning: same viewing
		ins.run(1, 'tv', 1, 1, 1, '2026-04-11T23:00:00.000Z', 'import'); // 24.5h after the kept one: a rewatch
		ins.run(1, 'tv', 1, 1, 1, '2026-09-01T20:00:00.000Z', 'import');
		dedupeImportedPlays(d, 24 * 3600_000);
		expect(left().map((p) => p.watched_at)).toEqual(['2026-04-10T22:30:00.000Z', '2026-04-11T23:00:00.000Z', '2026-09-01T20:00:00.000Z']);
	});

	it('never removes plays made in Seek or sent by Jellyfin, and keeps people and films apart', () => {
		const ins = seed();
		ins.run(1, 'tv', 1, 1, 1, '2026-04-10T20:00:00.000Z', 'import');
		ins.run(1, 'tv', 1, 1, 1, '2026-04-10T20:10:00.000Z', 'seek');
		ins.run(1, 'tv', 1, 1, 1, '2026-04-10T20:20:00.000Z', 'jellyfin');
		ins.run(2, 'tv', 1, 1, 1, '2026-04-10T20:05:00.000Z', 'import'); // the other person's own play
		ins.run(1, 'movie', 603, null, null, '2026-05-01T20:00:00.000Z', 'import');
		ins.run(1, 'movie', 603, null, null, '2026-05-01T22:00:00.000Z', 'import'); // film logged twice
		expect(dedupeImportedPlays(d, 24 * 3600_000).map((p) => p.media_type)).toEqual(['movie']);
		expect(left()).toHaveLength(5);
	});
});

describe('backup before migrating', () => {
	it('copies the database once before pending migrations, and not for a new or current file', () => {
		const dir = mkdtempSync(join(tmpdir(), 'seek-db-'));
		const file = join(dir, 'seek.db');
		const raw = new Database(file);
		expect(backupBeforeMigrating(raw, file)).toBeNull(); // brand new
		raw.pragma(`user_version = ${MIGRATIONS.length - 1}`);
		const to = backupBeforeMigrating(raw, file);
		expect(to && existsSync(to)).toBe(true);
		expect(backupBeforeMigrating(raw, file)).toBe(to); // same day: not copied again
		raw.pragma(`user_version = ${MIGRATIONS.length}`);
		expect(backupBeforeMigrating(raw, file)).toBeNull(); // nothing pending
		raw.close();
		expect(readdirSync(dir).filter((f) => f.endsWith('.bak'))).toHaveLength(1);
	});
});
