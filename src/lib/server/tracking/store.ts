/** What each person tracks and has watched, in Seek's own database (v13). */
import { db, nowIso } from '../db';
import type { MediaType, PlayRow, Review, TrackedRow } from './importMap';

/** Make Seek's tracked titles for one person and media type match `rows` exactly. */
export function replaceTracked(userId: number, mediaType: MediaType, rows: TrackedRow[]): { kept: number; removed: number } {
	const d = db();
	let removed = 0;
	d.transaction(() => {
		const up = d.prepare(
			`INSERT INTO tracked (user_id, media_type, tmdb_id, status, score, notes, added_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (user_id, media_type, tmdb_id) DO UPDATE SET status = excluded.status, score = excluded.score,
				notes = excluded.notes, added_at = excluded.added_at, updated_at = excluded.updated_at`
		);
		for (const r of rows) up.run(userId, mediaType, r.tmdbId, r.status, r.score, r.notes, r.addedAt, r.updatedAt);
		const keep = new Set(rows.map((r) => r.tmdbId));
		const have = d.prepare('SELECT tmdb_id FROM tracked WHERE user_id = ? AND media_type = ?').all(userId, mediaType) as { tmdb_id: number }[];
		const del = d.prepare('DELETE FROM tracked WHERE user_id = ? AND media_type = ? AND tmdb_id = ?');
		for (const h of have) if (!keep.has(h.tmdb_id)) (del.run(userId, mediaType, h.tmdb_id), removed++);
	})();
	return { kept: rows.length, removed };
}

/** Make the copied plays for one person and media type match `plays` exactly:
 *  add new ones, drop ones Floppy no longer has (unmarked). Plays Seek recorded
 *  itself (source seek/jellyfin) are never touched. */
export function syncImportedPlays(userId: number, mediaType: MediaType, plays: PlayRow[]): { added: number; removed: number } {
	const d = db();
	let added = 0;
	let removed = 0;
	d.transaction(() => {
		const ins = d.prepare(
			`INSERT OR IGNORE INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, external_key, created_at)
			VALUES (?, ?, ?, ?, ?, ?, 'import', ?, ?)`
		);
		const now = nowIso();
		for (const p of plays) added += ins.run(userId, mediaType, p.tmdbId, p.season, p.episode, p.watchedAt, p.externalKey, now).changes;
		const keep = new Set(plays.map((p) => p.externalKey));
		const have = d
			.prepare("SELECT id, external_key FROM plays WHERE user_id = ? AND media_type = ? AND source = 'import'")
			.all(userId, mediaType) as { id: number; external_key: string }[];
		const del = d.prepare('DELETE FROM plays WHERE id = ?');
		for (const h of have) if (!keep.has(h.external_key)) (del.run(h.id), removed++);
	})();
	return { added, removed };
}

/** This run's review notes replace the last run's. */
export function replaceReviews(userId: number, reviews: Review[]): void {
	const d = db();
	d.transaction(() => {
		d.prepare('DELETE FROM import_review WHERE user_id = ?').run(userId);
		const ins = d.prepare(
			'INSERT OR IGNORE INTO import_review (user_id, media_type, ref, reason, detail, seen_at) VALUES (?, ?, ?, ?, ?, ?)'
		);
		const now = nowIso();
		for (const r of reviews) ins.run(userId, r.mediaType, r.ref, r.reason, r.detail, now);
	})();
}

export function importedPlayCount(userId: number, mediaType: MediaType): number {
	return (
		db().prepare("SELECT COUNT(*) AS n FROM plays WHERE user_id = ? AND media_type = ? AND source = 'import'").get(userId, mediaType) as {
			n: number;
		}
	).n;
}

/**
 * Copied episode plays checked against Seek's TMDB copy: plays on an episode TMDB
 * doesn't have (a renumbered show) are listed for review; plays of a show whose
 * info hasn't been fetched yet are only counted, and checked on a later run.
 */
export function checkEpisodes(userId: number): { missing: Review[]; pending: number } {
	const rows = db()
		.prepare(
			`SELECT p.tmdb_id, p.season, p.episode, t.title, t.refreshed_at, COUNT(*) AS n,
				EXISTS (SELECT 1 FROM episodes e WHERE e.tmdb_id = p.tmdb_id AND e.season = p.season AND e.episode = p.episode) AS found
			FROM plays p LEFT JOIN titles t ON t.media_type = 'tv' AND t.tmdb_id = p.tmdb_id
			WHERE p.user_id = ? AND p.media_type = 'tv'
			GROUP BY p.tmdb_id, p.season, p.episode`
		)
		.all(userId) as { tmdb_id: number; season: number; episode: number; title: string | null; refreshed_at: string | null; n: number; found: number }[];
	let pending = 0;
	const missing: Review[] = [];
	for (const r of rows) {
		if (r.found) continue;
		if (!r.refreshed_at) {
			pending += r.n;
			continue;
		}
		missing.push({
			mediaType: 'tv',
			ref: `tmdb:${r.tmdb_id}:S${r.season}E${r.episode}`,
			reason: 'episode-not-in-tmdb',
			detail: `${r.title ?? ''} — ${r.n} play${r.n === 1 ? '' : 's'}`
		});
	}
	return { missing, pending };
}

export type ImportSummary = {
	ranAt: string;
	tracked: Record<MediaType, number>;
	/** Floppy's history total vs the plays Seek holds from it, per media type. */
	plays: Record<MediaType, { floppy: number; seek: number; skipped: number }>;
	added: number;
	removed: number;
	review: number;
	pendingCatalog: number;
	/** Every Floppy play accounted for, and nothing needs review. */
	matches: boolean;
};

export function recordRun(userId: number, summary: ImportSummary): void {
	db()
		.prepare(
			'INSERT INTO import_runs (user_id, ran_at, summary) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET ran_at = excluded.ran_at, summary = excluded.summary'
		)
		.run(userId, summary.ranAt, JSON.stringify(summary));
}

export function lastRun(userId: number): ImportSummary | null {
	const r = db().prepare('SELECT summary FROM import_runs WHERE user_id = ?').get(userId) as { summary: string } | undefined;
	return r ? (JSON.parse(r.summary) as ImportSummary) : null;
}

export function reviewsFor(userId: number, limit = 50): Review[] {
	return (
		db()
			.prepare('SELECT media_type, ref, reason, detail FROM import_review WHERE user_id = ? ORDER BY reason, ref LIMIT ?')
			.all(userId, limit) as { media_type: string; ref: string; reason: string; detail: string }[]
	).map((r) => ({ mediaType: r.media_type, ref: r.ref, reason: r.reason, detail: r.detail }));
}
