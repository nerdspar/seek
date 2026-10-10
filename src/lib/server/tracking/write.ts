/**
 * Every change to what you track and have watched — Seek is the record
 * (own-tracking plan). Marks on a shared show or film land for the whole
 * household at once (`watchers`).
 */
import { db, nowIso } from '../db';
import { aired } from './nextUp';
import { isShared, type SharedKind } from '../household/shared';
import { mirrorMembers } from '../household/mirror';
import type { User } from '../users';

export type Kind = 'tv' | 'movie';

/** Status codes, as stored in `tracked.status`. */
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

/** Stop tracking: the title and every play of it go. */
export function untrack(userId: number, kind: Kind, tmdbId: number): void {
	const d = db();
	d.transaction(() => {
		d.prepare('DELETE FROM tracked WHERE user_id = ? AND media_type = ? AND tmdb_id = ?').run(userId, kind, tmdbId);
		d.prepare('DELETE FROM plays WHERE user_id = ? AND media_type = ? AND tmdb_id = ?').run(userId, kind, tmdbId);
	})();
}

/** A play of an episode (or of a film: no season/episode). A planned show moves to Watching. */
export function recordPlay(
	userId: number,
	kind: Kind,
	tmdbId: number,
	season: number | null,
	episode: number | null,
	at = nowIso(),
	source: 'seek' | 'jellyfin' = 'seek'
): void {
	const d = db();
	d.transaction(() => {
		d.prepare(
			`INSERT INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		).run(userId, kind, tmdbId, season, episode, at, source, nowIso());
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
 * Mark a season: the next `count` aired episodes with no play yet, in order.
 * Episodes come from Seek's TMDB copy; if it doesn't have the season yet,
 * nothing is recorded (the nightly copy fills it in).
 */
export function fillSeason(userId: number, tmdbId: number, season: number, count: number, now = Date.now(), at?: string): number {
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
	const when = at ?? new Date(now).toISOString();
	for (const e of todo) recordPlay(userId, 'tv', tmdbId, season, e.episode, when);
	return todo.length;
}

/** Unmark a season: every play in it. */
export function clearSeason(userId: number, tmdbId: number, season: number): void {
	db().prepare("DELETE FROM plays WHERE user_id = ? AND media_type = 'tv' AND tmdb_id = ? AND season = ?").run(userId, tmdbId, season);
}

/** Who a mark counts for: you, plus the household for a shared show or film.
 *  Unmarking stays yours alone. */
export function watchers(me: User, source: string, mediaId: string, kind: SharedKind): number[] {
	if (!isShared(me.householdId, source, mediaId, kind)) return [me.id];
	const members = mirrorMembers(me.householdId).map((u) => u.id);
	return members.length >= 2 ? [...new Set([me.id, ...members])] : [me.id];
}

/** Has this person a play of this episode/film within `windowMs` of `at`? */
export function playedNear(userId: number, kind: Kind, tmdbId: number, season: number | null, episode: number | null, at: string, windowMs: number): boolean {
	const rows = db()
		.prepare('SELECT watched_at FROM plays WHERE user_id = ? AND media_type = ? AND tmdb_id = ? AND season IS ? AND episode IS ?')
		.all(userId, kind, tmdbId, season, episode) as { watched_at: string }[];
	const t = Date.parse(at);
	return rows.some((r) => Math.abs(Date.parse(r.watched_at) - t) <= windowMs);
}

/**
 * After a play: a show that has ended and is now fully watched becomes
 * Completed. A show still running stays Watching — caught up, it simply drops
 * out of the backlog until the next episode airs.
 */
export function settleCompletion(userId: number, tmdbId: number, now = Date.now()): void {
	const d = db();
	const t = d.prepare("SELECT status FROM titles WHERE media_type = 'tv' AND tmdb_id = ?").get(tmdbId) as { status: string | null } | undefined;
	if (t?.status !== 'Ended' && t?.status !== 'Canceled') return;
	const eps = d.prepare('SELECT season, episode, air_date AS airDate, air_at AS airAt FROM episodes WHERE tmdb_id = ? AND season > 0').all(tmdbId) as {
		season: number;
		episode: number;
		airDate: string | null;
		airAt: string | null;
	}[];
	if (!eps.length || eps.some((e) => !aired(e, now))) return;
	const played = new Set(
		(d.prepare("SELECT DISTINCT season, episode FROM plays WHERE user_id = ? AND media_type = 'tv' AND tmdb_id = ?").all(userId, tmdbId) as {
			season: number;
			episode: number;
		}[]).map((p) => `${p.season}:${p.episode}`)
	);
	if (eps.some((e) => !played.has(`${e.season}:${e.episode}`))) return;
	d.prepare(
		"UPDATE tracked SET status = ?, updated_at = ? WHERE user_id = ? AND media_type = 'tv' AND tmdb_id = ? AND status IN (?, ?)"
	).run(Status.Completed, nowIso(), userId, tmdbId, Status.Planning, Status.Watching);
}

/**
 * After an unmark: a Completed show with a gap in it again is back to
 * Watching; a Completed film with no plays left is back to Planning. Only
 * from Completed — Paused or Dropped was set deliberately — and only when
 * nothing of it is left watched (removing one play of a rewatch changes nothing).
 * `episode` null means the whole season.
 */
export function afterUnplay(userId: number, kind: Kind, tmdbId: number, season: number | null, episode: number | null): void {
	const d = db();
	const left =
		kind === 'movie'
			? d.prepare("SELECT 1 FROM plays WHERE user_id = ? AND media_type = 'movie' AND tmdb_id = ?").get(userId, tmdbId)
			: episode === null
				? d.prepare("SELECT 1 FROM plays WHERE user_id = ? AND media_type = 'tv' AND tmdb_id = ? AND season = ?").get(userId, tmdbId, season)
				: d.prepare("SELECT 1 FROM plays WHERE user_id = ? AND media_type = 'tv' AND tmdb_id = ? AND season = ? AND episode = ?").get(userId, tmdbId, season, episode);
	if (left) return;
	d.prepare('UPDATE tracked SET status = ?, updated_at = ? WHERE user_id = ? AND media_type = ? AND tmdb_id = ? AND status = ?').run(
		kind === 'movie' ? Status.Planning : Status.Watching,
		nowIso(),
		userId,
		kind,
		tmdbId,
		Status.Completed
	);
}

export type PlayEntry = { id: number; season: number | null; episode: number | null; watchedAt: string; source: string };

/** This person's plays of an episode, a whole season (`episode` null) or a film
 *  (both null), newest first — the play history in the long-press menu. */
export function playsOf(userId: number, kind: Kind, tmdbId: number, season: number | null, episode: number | null): PlayEntry[] {
	const where =
		kind === 'movie' ? '' : episode === null ? 'AND season = ?' : 'AND season = ? AND episode = ?';
	const args = kind === 'movie' ? [] : episode === null ? [season] : [season, episode];
	return (
		db()
			.prepare(
				`SELECT id, season, episode, watched_at, source FROM plays WHERE user_id = ? AND media_type = ? AND tmdb_id = ? ${where}
				ORDER BY watched_at DESC, id DESC`
			)
			.all(userId, kind, tmdbId, ...args) as { id: number; season: number | null; episode: number | null; watched_at: string; source: string }[]
	).map((r) => ({ id: r.id, season: r.season, episode: r.episode, watchedAt: r.watched_at, source: r.source }));
}

/** Remove one play by id — only one of this person's own. Returns what it was. */
export function removePlay(userId: number, playId: number): { kind: Kind; tmdbId: number; season: number | null; episode: number | null } | null {
	const r = db().prepare('SELECT media_type, tmdb_id, season, episode FROM plays WHERE id = ? AND user_id = ?').get(playId, userId) as
		| { media_type: Kind; tmdb_id: number; season: number | null; episode: number | null }
		| undefined;
	if (!r) return null;
	db().prepare('DELETE FROM plays WHERE id = ?').run(playId);
	afterUnplay(userId, r.media_type, r.tmdb_id, r.season, r.episode);
	return { kind: r.media_type, tmdbId: r.tmdb_id, season: r.season, episode: r.episode };
}

/** Watched a whole season again: one more play of every aired episode in it,
 *  watched or not, at `at`. Returns how many. */
export function rewatchSeason(userId: number, tmdbId: number, season: number, at = nowIso(), now = Date.now()): number {
	const eps = db()
		.prepare('SELECT episode, air_date AS airDate, air_at AS airAt FROM episodes WHERE tmdb_id = ? AND season = ? ORDER BY episode')
		.all(tmdbId, season) as { episode: number; airDate: string | null; airAt: string | null }[];
	const todo = eps.filter((e) => aired(e, now));
	for (const e of todo) recordPlay(userId, 'tv', tmdbId, season, e.episode, at);
	return todo.length;
}
