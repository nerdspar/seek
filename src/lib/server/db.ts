/**
 * Seek's own database — the household user store (docs/household-multiuser-plan.md).
 *
 * Seek used to be stateless (two JSON files). Multi-user needs real storage:
 * accounts, sessions that can be invalidated, invites, and per-user credentials.
 * SQLite via better-sqlite3 (synchronous, transactional) in /data next to the
 * legacy JSON it migrates from. Watch state never lives here — it stays in each
 * person's Floppy; reading state lives on each person's Hardcover shelf.
 *
 * Migrations are append-only SQL run at open, tracked by PRAGMA user_version.
 * Never edit a shipped migration — add a new one.
 */
import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type DB = Database.Database;

/** SQL, or — rarely — a step that needs code (still run in the transaction). */
type Migration = string | ((db: DB) => void);

export const MIGRATIONS: Migration[] = [
	// v1 — households, accounts, invites/resets, per-user credentials + prefs,
	// push subscriptions. Covers household phases A–C and books.
	`
	CREATE TABLE households (
		id          INTEGER PRIMARY KEY,
		name        TEXT NOT NULL,
		created_at  TEXT NOT NULL
	);

	CREATE TABLE users (
		id                          INTEGER PRIMARY KEY,
		household_id                INTEGER NOT NULL REFERENCES households(id),
		email                       TEXT NOT NULL UNIQUE COLLATE NOCASE,
		name                        TEXT NOT NULL,
		password_hash               TEXT NOT NULL,
		role                        TEXT NOT NULL CHECK (role IN ('owner', 'member')),
		-- Bumped on password change / sign-out-everywhere; sessions carry it, so a
		-- bump invalidates every outstanding cookie for this user.
		session_version             INTEGER NOT NULL DEFAULT 1,
		email_verified_at           TEXT,
		-- Credentials Seek uses on this person's behalf, AES-GCM encrypted
		-- (crypto.ts). Null = not linked.
		floppy_token_enc            TEXT,
		floppy_calendar_token_enc   TEXT,
		bookorbit_username          TEXT,
		bookorbit_password_enc      TEXT,
		bookorbit_library_id        INTEGER,
		-- This person's Seek preferences (prefs.ts), JSON.
		prefs_json                  TEXT,
		-- Per-user notification guards (were global in push-subscriptions.json).
		last_digest                 TEXT,
		last_at_time                TEXT,
		created_at                  TEXT NOT NULL
	);

	-- Invite (no user yet: email + household), email verification, password reset.
	-- Only a hash of the token is stored; the raw token lives in the link.
	CREATE TABLE email_tokens (
		id            INTEGER PRIMARY KEY,
		kind          TEXT NOT NULL CHECK (kind IN ('invite', 'verify', 'reset')),
		user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
		household_id  INTEGER REFERENCES households(id) ON DELETE CASCADE,
		email         TEXT COLLATE NOCASE,
		token_hash    TEXT NOT NULL UNIQUE,
		expires_at    TEXT NOT NULL,
		used_at       TEXT,
		created_at    TEXT NOT NULL
	);

	CREATE TABLE push_subscriptions (
		endpoint    TEXT PRIMARY KEY,
		user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		p256dh      TEXT NOT NULL,
		auth        TEXT NOT NULL,
		created_at  TEXT NOT NULL
	);
	CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
	`,

	// v2 — the books wishlist: "want to read" for books you don't own yet.
	// BookOrbit can only hold status for books in the library, so the rest of a
	// person's reading wishlist (what Goodreads used to keep) lives here. Keyed
	// by Hardcover id; the display fields are a snapshot so the list renders
	// without calling Hardcover.
	`
	CREATE TABLE wishlist (
		user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		hardcover_id  INTEGER NOT NULL,
		title         TEXT NOT NULL,
		author        TEXT,
		cover_url     TEXT,
		year          INTEGER,
		added_at      TEXT NOT NULL,
		PRIMARY KEY (user_id, hardcover_id)
	);
	`,
	// v3 — shared shows: watching one credits everyone in the household.
	`
	CREATE TABLE shared_shows (
		household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
		source        TEXT NOT NULL,
		media_id      TEXT NOT NULL,
		title         TEXT,
		added_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
		created_at    TEXT NOT NULL,
		PRIMARY KEY (household_id, source, media_id)
	);
	-- One row per play already carried from one person to another (or found to be
	-- there already), so the reconciler never posts the same play twice.
	CREATE TABLE mirror_log (
		origin_user      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		origin_instance  INTEGER NOT NULL,
		target_user      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		source           TEXT NOT NULL,
		media_id         TEXT NOT NULL,
		season           INTEGER NOT NULL,
		episode          INTEGER NOT NULL,
		played_at        TEXT NOT NULL,
		outcome          TEXT NOT NULL,
		created_at       TEXT NOT NULL,
		PRIMARY KEY (origin_user, origin_instance, target_user)
	);
	-- How far back each person's history has been checked.
	CREATE TABLE mirror_state (
		user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		scanned_at  TEXT NOT NULL
	);
	`,
	// v4 — the household's service settings (Floppy/BookOrbit addresses, API
	// keys…), edited in Settings → Services instead of the compose file. Secret
	// values are encrypted like account links.
	`
	CREATE TABLE settings (
		key         TEXT PRIMARY KEY,
		value       TEXT NOT NULL,
		updated_at  TEXT NOT NULL
	);
	`,
	// v5 — books you track that aren't in BookOrbit (a physical copy, a library
	// loan, one you want): your status, rating and page for each. Replaces the
	// want-to-read-only wishlist, whose rows carry over as want_to_read.
	`
	CREATE TABLE book_entries (
		user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		hardcover_id    INTEGER NOT NULL,
		title           TEXT NOT NULL,
		author          TEXT,
		cover_url       TEXT,
		year            INTEGER,
		pages           INTEGER,
		status          TEXT NOT NULL,
		rating          INTEGER,
		progress_pages  INTEGER,
		started_at      TEXT,
		finished_at     TEXT,
		added_at        TEXT NOT NULL,
		updated_at      TEXT NOT NULL,
		PRIMARY KEY (user_id, hardcover_id)
	);
	INSERT INTO book_entries (user_id, hardcover_id, title, author, cover_url, year, status, added_at, updated_at)
		SELECT user_id, hardcover_id, title, author, cover_url, year, 'want_to_read', added_at, added_at FROM wishlist;
	DROP TABLE wishlist;
	`,
	// v6 — your own Hardcover token (optional, encrypted): what you've read and
	// rated there seeds your book recommendations.
	`
	ALTER TABLE users ADD COLUMN hardcover_token_enc TEXT;
	`,
	// v7 — together or solo for new shows. A household setting (ask / together /
	// solo), and each new show's answer: 'pending' sits in the inbox until one of
	// you decides, 'solo' is decided (together lives in shared_shows). Shows added
	// before this existed count as decided, hence the timestamp.
	`
	ALTER TABLE households ADD COLUMN new_shows TEXT NOT NULL DEFAULT 'ask';
	ALTER TABLE households ADD COLUMN new_shows_since TEXT;
	UPDATE households SET new_shows_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
	CREATE TABLE show_choices (
		household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
		source        TEXT NOT NULL,
		media_id      TEXT NOT NULL,
		title         TEXT,
		choice        TEXT NOT NULL CHECK (choice IN ('solo', 'pending')),
		user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
		created_at    TEXT NOT NULL,
		PRIMARY KEY (household_id, source, media_id)
	);
	`,
	// v8 — anime, decided by hand: TMDB says what's anime (Animation from
	// Japan), and this is where the household overrules it for a show.
	`
	CREATE TABLE anime_overrides (
		household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
		source        TEXT NOT NULL,
		media_id      TEXT NOT NULL,
		is_anime      INTEGER NOT NULL,
		user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
		created_at    TEXT NOT NULL,
		PRIMARY KEY (household_id, source, media_id)
	);
	`,
	// v9 — films can be shared too. A film and a show can share a TMDB number,
	// so the shared list is keyed by media type as well (existing rows are shows).
	`
	CREATE TABLE shared_shows_v9 (
		household_id  INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
		media_type    TEXT NOT NULL DEFAULT 'tv' CHECK (media_type IN ('tv', 'movie')),
		source        TEXT NOT NULL,
		media_id      TEXT NOT NULL,
		title         TEXT,
		added_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
		created_at    TEXT NOT NULL,
		PRIMARY KEY (household_id, media_type, source, media_id)
	);
	INSERT INTO shared_shows_v9 (household_id, media_type, source, media_id, title, added_by, created_at)
		SELECT household_id, 'tv', source, media_id, title, added_by, created_at FROM shared_shows;
	DROP TABLE shared_shows;
	ALTER TABLE shared_shows_v9 RENAME TO shared_shows;
	`,
	// v10 — reading state moved to Hardcover: who has had their books moved
	// there (once each — see books/moveToHardcover.ts).
	`
	CREATE TABLE books_moved (
		user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		moved_at  TEXT NOT NULL
	);
	`,
	// v11 — the move to Hardcover is done: Seek's old book records and the
	// "moved" markers go. Anyone whose move never finished keeps their rows in
	// book_entries-unmoved.json beside the database, so nothing is lost silently.
	(db) => {
		const unmoved = db.prepare('SELECT * FROM book_entries WHERE user_id NOT IN (SELECT user_id FROM books_moved)').all();
		if (unmoved.length) {
			console.warn(`[db] ${unmoved.length} book record(s) never moved to Hardcover — kept in book_entries-unmoved.json`);
			if (db.name !== ':memory:') writeFileSync(join(dirname(db.name), 'book_entries-unmoved.json'), JSON.stringify(unmoved, null, 2));
		}
		db.exec('DROP TABLE book_entries; DROP TABLE books_moved;');
	}
];

/** Open (creating if needed) and migrate a database. ':memory:' for tests. */
export function openDatabase(file: string): DB {
	if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
	const db = new Database(file);
	db.pragma('journal_mode = WAL');
	db.pragma('foreign_keys = ON');
	migrate(db);
	return db;
}

export function migrate(db: DB): void {
	const current = db.pragma('user_version', { simple: true }) as number;
	for (let v = current; v < MIGRATIONS.length; v++) {
		db.transaction(() => {
			const m = MIGRATIONS[v];
			if (typeof m === 'string') db.exec(m);
			else m(db);
			db.pragma(`user_version = ${v + 1}`);
		})();
	}
}

/** Where Seek keeps its state (the container's /data volume). */
export const dataDir = () => env.SEEK_DATA_DIR || '/data';

const dbPath = () => env.SEEK_DB_PATH || join(dataDir(), 'seek.db');

let instance: DB | null = null;

/** The process-wide database, opened lazily on first use. */
export function db(): DB {
	if (!instance) instance = openDatabase(dbPath());
	return instance;
}

/** Tests swap in an in-memory database. */
export function useDatabase(next: DB | null): void {
	instance = next;
}

export const nowIso = () => new Date().toISOString();
