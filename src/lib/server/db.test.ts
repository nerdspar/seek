import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS, migrate } from './db';

describe('migration v9 (films can be shared)', () => {
	it('keeps every shared show, now marked as a show, and lets a film share its TMDB number', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		// A household as it stood before v9, with shows already shared.
		for (let v = 0; v < 8; v++) db.exec(MIGRATIONS[v] as string);
		db.pragma('user_version = 8');
		db.prepare("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'now')").run();
		db.prepare(
			"INSERT INTO shared_shows (household_id, source, media_id, title, created_at) VALUES (1, 'tmdb', '603', 'A show', 'then')"
		).run();

		migrate(db);

		expect(db.prepare('SELECT media_type, source, media_id, title FROM shared_shows').all()).toEqual([
			{ media_type: 'tv', source: 'tmdb', media_id: '603', title: 'A show' }
		]);
		db.prepare(
			"INSERT INTO shared_shows (household_id, media_type, source, media_id, title, created_at) VALUES (1, 'movie', 'tmdb', '603', 'The Matrix', 'now')"
		).run();
		expect(db.prepare('SELECT COUNT(*) AS n FROM shared_shows').get()).toEqual({ n: 2 });
	});
});

describe('migration v19 (the last of Floppy)', () => {
	it('drops the stored Floppy tokens and the copy bookkeeping, keeping every play', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		for (let v = 0; v < 18; v++) {
			const m = MIGRATIONS[v];
			if (typeof m === 'string') db.exec(m);
			else m(db);
		}
		db.pragma('user_version = 18');
		db.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
		db.exec(
			"INSERT INTO users (id, household_id, email, name, role, password_hash, created_at, floppy_token_enc, floppy_calendar_token_enc) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x', 'v1:secret', 'v1:cal')"
		);
		db.exec(
			"INSERT INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, external_key, created_at) VALUES (1, 'tv', 10, 1, 1, '2026-01-01T00:00:00Z', 'import', 'floppy:episode:1', 'x')"
		);

		migrate(db);

		const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
		expect(cols('users').filter((c) => c.startsWith('floppy'))).toEqual([]);
		expect(cols('plays')).not.toContain('external_key');
		const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
		expect(tables).not.toContain('import_review');
		expect(tables).not.toContain('import_runs');
		expect(db.prepare('SELECT tmdb_id, season, episode, watched_at FROM plays').all()).toEqual([
			{ tmdb_id: 10, season: 1, episode: 1, watched_at: '2026-01-01T00:00:00Z' }
		]);
	});
});
