/**
 * Seek's own record of each change you make (own-tracking plan, step 3: writes
 * first). While Floppy is still primary, every successful Floppy write is
 * mirrored here, so Seek's copy is always the freshest; the nightly copy then
 * makes Seek match Floppy exactly (linking these plays to Floppy's, dropping
 * any Floppy doesn't have). Best-effort: a failure here never fails your action.
 */
import { db, nowIso } from '../db';
import { aired } from './nextUp';
import { isShared, type SharedKind } from '../household/shared';
import { mirrorMembers } from '../household/mirror';
import type { User } from '../users';

export type Kind = 'tv' | 'movie';

/** Floppy's status codes, which Seek keeps. */
export const Status = { Planning: 0, Watching: 1, Paused: 2, Completed: 3, Dropped: 4 } as const;

/** The TMDB id, when this is a TMDB item (the only kind Seek keeps). */
export function tmdbIdOf(source: string, mediaId: string): number | null {
	const id = Number(mediaId);
	return source === 'tmdb' && Number.isInteger(id) && id > 0 ? id : null;
}

/** Run a mirror write, logging instead of throwing. */
export function mirror(what: string, fn: () => void): void {
	try {
		fn();
	} catch (err) {
		console.warn(`[tracking] couldn't record ${what} in Seek:`, err);
	}
}

/** Track a title if it isn't already (added as Planning, or as `status`). */
export function ensureTracked(userId: number, kind: Kind, tmdbId: number, status: number = Status.Planning, now = nowIso()): void {
	db()
		.prepare(
			`INSERT OR IGNORE INTO tracked (user_id, media_type, tmdb_id, status, score, notes, added_at, updated_at)
			VALUES (?, ?, ?, ?, NULL, '', ?, ?)`
		)
		.run(userId, kind, tmdbId, status, now, now);
}

/** Change status and/or rating. */
export function setTracked(userId: number, kind: Kind, tmdbId: number, change: { status?: number; score?: number | null }, now = nowIso()): void {
	ensureTracked(userId, kind, tmdbId, change.status ?? Status.Planning, now);
	const d = db();
	if (change.status !== undefined) {
		d.prepare('UPDATE tracked SET status = ?, updated_at = ? WHERE user_id = ? AND media_type = ? AND tmdb_id = ?').run(change.status, now, userId, kind, tmdbId);
	}
	if (change.score !== undefined) {
		d.prepare('UPDATE tracked SET score = ?, updated_at = ? WHERE user_id = ? AND media_type = ? AND tmdb_id = ?').run(change.score, now, userId, kind, tmdbId);
	}
}

/** Stop tracking: the title and every play of it go, as in Floppy. */
export function untrack(userId: number, kind: Kind, tmdbId: number): void {
	const d = db();
	d.transaction(() => {
		d.prepare('DELETE FROM tracked WHERE user_id = ? AND media_type = ? AND tmdb_id = ?').run(userId, kind, tmdbId);
		d.prepare('DELETE FROM plays WHERE user_id = ? AND media_type = ? AND tmdb_id = ?').run(userId, kind, tmdbId);
	})();
}

/** A play of an episode (or of a film: no season/episode). A planned show moves to Watching. */
export function recordPlay(userId: number, kind: Kind, tmdbId: number, season: number | null, episode: number | null, at = nowIso()): void {
	const d = db();
	d.transaction(() => {
		d.prepare(
			`INSERT INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, external_key, created_at)
			VALUES (?, ?, ?, ?, ?, ?, 'seek', NULL, ?)`
		).run(userId, kind, tmdbId, season, episode, at, nowIso());
		ensureTracked(userId, kind, tmdbId, kind === 'movie' ? Status.Completed : Status.Watching, at);
		if (kind === 'tv') {
			d.prepare('UPDATE tracked SET status = ?, updated_at = ? WHERE user_id = ? AND media_type = ? AND tmdb_id = ? AND status = ?').run(
				Status.Watching,
				at,
				userId,
				kind,
				tmdbId,
				Status.Planning
			);
		}
	})();
}

/** Undo: the newest play of this episode (or film). */
export function removeNewestPlay(userId: number, kind: Kind, tmdbId: number, season: number | null, episode: number | null): boolean {
	const r = db()
		.prepare(
			`DELETE FROM plays WHERE id = (
				SELECT id FROM plays WHERE user_id = ? AND media_type = ? AND tmdb_id = ? AND season IS ? AND episode IS ?
				ORDER BY watched_at DESC, id DESC LIMIT 1)`
		)
		.run(userId, kind, tmdbId, season, episode);
	return r.changes > 0;
}

/**
 * Mark a season: the next `count` aired episodes with no play yet, in order —
 * what Floppy's "increase progress" does. Episodes come from Seek's TMDB copy;
 * if it doesn't have the season yet, nothing is recorded (the nightly copy
 * fills it in).
 */
export function fillSeason(userId: number, tmdbId: number, season: number, count: number, now = Date.now()): number {
	const d = db();
	const eps = d
		.prepare('SELECT episode, air_date AS airDate, air_at AS airAt FROM episodes WHERE tmdb_id = ? AND season = ? ORDER BY episode')
		.all(tmdbId, season) as { episode: number; airDate: string | null; airAt: string | null }[];
	const played = new Set(
		(d.prepare("SELECT DISTINCT episode FROM plays WHERE user_id = ? AND media_type = 'tv' AND tmdb_id = ? AND season = ?").all(userId, tmdbId, season) as {
			episode: number;
		}[]).map((r) => r.episode)
	);
	const todo = eps.filter((e) => !played.has(e.episode) && aired(e, now)).slice(0, count);
	const at = new Date(now).toISOString();
	for (const e of todo) recordPlay(userId, 'tv', tmdbId, season, e.episode, at);
	return todo.length;
}

/** Unmark a season: every play in it. */
export function clearSeason(userId: number, tmdbId: number, season: number): void {
	db().prepare("DELETE FROM plays WHERE user_id = ? AND media_type = 'tv' AND tmdb_id = ? AND season = ?").run(userId, tmdbId, season);
}

/** Who a mark counts for: you, plus the household for a shared show or film —
 *  as the household mirror does in Floppy. Unmarking stays yours alone. */
export function watchers(me: User, source: string, mediaId: string, kind: SharedKind): number[] {
	if (!isShared(me.householdId, source, mediaId, kind)) return [me.id];
	const members = mirrorMembers(me.householdId).map((u) => u.id);
	return members.length >= 2 ? [...new Set([me.id, ...members])] : [me.id];
}
