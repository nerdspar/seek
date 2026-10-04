import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { MIGRATIONS, migrate } from './db';

describe('migration v9 (films can be shared)', () => {
	it('keeps every shared show, now marked as a show, and lets a film share its TMDB number', () => {
		const db = new Database(':memory:');
		db.pragma('foreign_keys = ON');
		// A household as it stood before v9, with shows already shared.
		for (let v = 0; v < 8; v++) db.exec(MIGRATIONS[v]);
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
