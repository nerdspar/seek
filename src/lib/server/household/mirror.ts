/**
 * Shared-show mirroring: a play of a shared show (or film) by one of you is
 * recorded for the others too, at the same time, so you both get credit for
 * watching it together — however it was logged (Seek, Floppy, or Jellyfin's
 * auto-scrobble). A film is one "episode": season 0, episode 0.
 *
 * How it stays correct without help from Floppy (whose watch POST appends —
 * it never upserts or dedupes):
 *
 * - **The partner check.** Before carrying a play at time T over, look at the
 *   partner's own plays of that episode. If they have one within 12 hours of T,
 *   they've got credit already — you watched together, each logged it, or a
 *   previous run (even one that timed out) already carried it. Nothing is posted.
 *   This alone makes every run idempotent, and stops echoes: the mirrored play,
 *   seen later in the partner's history, finds the original next to it.
 * - **mirror_log** records what was carried (or found already there) so the
 *   next run skips it without asking Floppy again.
 *
 * The scan reads each person's Floppy history (newest first) back to a little
 * before the last scan, so a late Jellyfin scrobble is still caught. Unmarking is
 * not mirrored: a play carried over is the partner's history now, theirs to undo.
 */
import { db, nowIso } from '../db';
import { listMembers, type User } from '../users';
import { runAs, floppyToken, NotLinkedError } from '../userctx';
import { floppy, FloppyError } from '../floppy';
import { addMedia } from '../search';
import { listShared, showKey, type SharedKind } from './shared';

export type Play = {
	/** 'tv' (an episode) or 'movie' (a film: season and episode are 0). */
	mediaType: SharedKind;
	source: string;
	mediaId: string;
	season: number;
	episode: number;
	/** When it was watched, epoch ms. */
	at: number;
	/** Floppy's id for this play (history instance), when known. */
	instance: number | null;
};

/** Two plays of one episode this close together are the same viewing. */
export const SAME_VIEWING_MS = 12 * 60 * 60 * 1000;
/** Re-read this much history before the last scan, for late scrobbles. */
export const LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});

/** Episode and film plays from a Floppy `/history/?flat=1` page (other media dropped). */
export function playsFromHistory(raw: unknown): Play[] {
	const results = rec(raw).results;
	if (!Array.isArray(results)) return [];
	return results.flatMap((e): Play[] => {
		const r = rec(e);
		const item = rec(r.item);
		const at = Date.parse(String(r.played_at_local ?? ''));
		const movie = r.media_type === 'movie';
		const season = movie ? 0 : Number(r.season_number ?? item.season_number);
		const episode = movie ? 0 : Number(r.episode_number ?? item.episode_number);
		if ((r.media_type !== 'episode' && !movie) || !item.media_id || !item.source || !Number.isFinite(at)) return [];
		if (!Number.isInteger(season) || !Number.isInteger(episode)) return [];
		const instance = Number(r.instance_id);
		return [
			{
				mediaType: movie ? 'movie' : 'tv',
				source: String(item.source),
				mediaId: String(item.media_id),
				season,
				episode,
				at,
				instance: Number.isInteger(instance) && instance > 0 ? instance : null
			}
		];
	});
}

const sameEpisode = (a: Play, b: Play) =>
	a.mediaType === b.mediaType &&
	a.source === b.source &&
	a.mediaId === b.mediaId &&
	a.season === b.season &&
	a.episode === b.episode;

/** The partner already has credit for this viewing. */
export const hasViewing = (theirs: Play[], p: Play) =>
	theirs.some((t) => sameEpisode(t, p) && Math.abs(t.at - p.at) <= SAME_VIEWING_MS);

/** The partner has watched this episode at some point (for the backfill). */
export const hasEpisode = (theirs: Play[], p: Play) => theirs.some((t) => sameEpisode(t, p));

/* ── Floppy, as a given person ───────────────────────────────────────────── */

export type Ops = {
	/** This person's episode and film plays since `sinceMs`, newest first. */
	recentPlays(user: User, sinceMs: number): Promise<Play[]>;
	/** Every play this person has of one show or film. */
	showPlays(user: User, source: string, mediaId: string, mediaType: SharedKind): Promise<Play[]>;
	/** Record a play for this person at the play's time. */
	postPlay(user: User, play: Play): Promise<void>;
};

const PAGE = 200;

async function historyPages(query: Record<string, string>, stop: (page: Play[]) => boolean, maxPages: number) {
	const out: Play[] = [];
	for (let page = 0; page < maxPages; page++) {
		const raw = await floppy<unknown>('/api/v1/history/', {
			query: { flat: '1', limit: String(PAGE), offset: String(page * PAGE), ...query }
		});
		const plays = playsFromHistory(raw);
		out.push(...plays);
		if (rec(raw).results && (rec(raw).results as unknown[]).length < PAGE) break;
		if (stop(plays)) break;
	}
	return out;
}

export const floppyOps: Ops = {
	recentPlays: (user, sinceMs) =>
		runAs(user, async () => {
			const recent = (mediaType: SharedKind) =>
				historyPages({ media_type: mediaType }, (page) => page.some((p) => p.at < sinceMs), 5).then((all) =>
					all.filter((p) => p.at >= sinceMs)
				);
			const [tv, movie] = await Promise.all([recent('tv'), recent('movie')]);
			return [...tv, ...movie].sort((a, b) => b.at - a.at);
		}),
	showPlays: (user, source, mediaId, mediaType) =>
		runAs(user, () => historyPages({ media_type: mediaType, source, media_id: mediaId }, () => false, 10)),
	postPlay: (user, play) =>
		runAs(user, async () => {
			const id = encodeURIComponent(play.mediaId);
			const path =
				play.mediaType === 'movie'
					? `/api/v1/media/movie/${play.source}/${id}/watch/`
					: `/api/v1/media/tv/${play.source}/${id}/${play.season}/episodes/${play.episode}/watch/`;
			const body = { end_date: new Date(play.at).toISOString() };
			try {
				await floppy(path, { method: 'POST', body });
			} catch (err) {
				// Not in their library yet: add it, then record the play.
				if (!(err instanceof FloppyError) || err.status !== 404) throw err;
				await addMedia(play.mediaType, play.source, play.mediaId).catch((e) => {
					if (!(e instanceof FloppyError && e.status === 409)) throw e;
				});
				await floppy(path, { method: 'POST', body });
			}
		})
};

/* ── The log ─────────────────────────────────────────────────────────────── */

function logged(origin: number, instance: number, target: number): boolean {
	return Boolean(
		db()
			.prepare('SELECT 1 FROM mirror_log WHERE origin_user = ? AND origin_instance = ? AND target_user = ?')
			.get(origin, instance, target)
	);
}

/** A play in this person's history that a mirror put there. */
function isMirrored(target: number, p: Play): boolean {
	return Boolean(
		db()
			.prepare(
				`SELECT 1 FROM mirror_log WHERE target_user = ? AND outcome = 'mirrored'
				 AND source = ? AND media_id = ? AND season = ? AND episode = ? AND played_at = ?`
			)
			.get(target, p.source, p.mediaId, p.season, p.episode, new Date(p.at).toISOString())
	);
}

function record(origin: number, target: number, p: Play, outcome: 'mirrored' | 'already'): void {
	if (p.instance === null) return;
	db()
		.prepare(
			`INSERT INTO mirror_log (origin_user, origin_instance, target_user, source, media_id, season, episode, played_at, outcome, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
		)
		.run(origin, p.instance, target, p.source, p.mediaId, p.season, p.episode, new Date(p.at).toISOString(), outcome, nowIso());
}

function lastScan(userId: number): number | null {
	const row = db().prepare('SELECT scanned_at FROM mirror_state WHERE user_id = ?').get(userId) as
		| { scanned_at: string }
		| undefined;
	return row ? Date.parse(row.scanned_at) : null;
}

function setLastScan(userId: number, at: number): void {
	db()
		.prepare(
			'INSERT INTO mirror_state (user_id, scanned_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET scanned_at = excluded.scanned_at'
		)
		.run(userId, new Date(at).toISOString());
}

/* ── Runs ────────────────────────────────────────────────────────────────── */

export type MirrorSummary = { mirrored: number; already: number; failed: number };

/** Household members who have Floppy linked (the owner may use the env token). */
export function mirrorMembers(householdId: number): User[] {
	return listMembers(householdId).filter((u) => {
		try {
			return runAs(u, () => Boolean(floppyToken()));
		} catch (e) {
			if (e instanceof NotLinkedError) return false;
			throw e;
		}
	});
}

/** Carry `plays` (from `from`) over to `to`, checking `to`'s own plays first. */
async function carry(
	from: User,
	to: User,
	plays: Play[],
	theirs: (source: string, mediaId: string, mediaType: SharedKind) => Promise<Play[]>,
	covered: (theirs: Play[], p: Play) => boolean,
	ops: Ops,
	sum: MirrorSummary
) {
	for (const p of plays) {
		if (p.instance !== null && logged(from.id, p.instance, to.id)) continue;
		const existing = await theirs(p.source, p.mediaId, p.mediaType);
		if (covered(existing, p)) {
			record(from.id, to.id, p, 'already');
			sum.already++;
			continue;
		}
		try {
			await ops.postPlay(to, p);
			record(from.id, to.id, p, 'mirrored');
			existing.push({ ...p, instance: null });
			sum.mirrored++;
		} catch (err) {
			// Left unlogged: the next run tries again, and the partner check stops
			// a doubled play if this one landed after all (e.g. a timeout).
			sum.failed++;
			const what = p.mediaType === 'movie' ? '' : ` S${p.season}E${p.episode}`;
			console.warn(`[mirror] ${from.id}→${to.id} ${showKey(p.source, p.mediaId, p.mediaType)}${what}:`, err);
		}
	}
}

/** Cache of a person's plays per show, for one run. */
function showCache(user: User, ops: Ops) {
	const cache = new Map<string, Promise<Play[]>>();
	return (source: string, mediaId: string, mediaType: SharedKind) => {
		const key = showKey(source, mediaId, mediaType);
		if (!cache.has(key)) cache.set(key, ops.showPlays(user, source, mediaId, mediaType));
		return cache.get(key)!;
	};
}

/**
 * One reconcile pass for a household: every member's recent plays of shared
 * shows, carried to everyone else who doesn't have that viewing yet.
 */
export async function reconcileHousehold(householdId: number, ops: Ops = floppyOps, now = Date.now()): Promise<MirrorSummary> {
	const sum: MirrorSummary = { mirrored: 0, already: 0, failed: 0 };
	const members = mirrorMembers(householdId);
	if (members.length < 2) return sum;
	const shared = new Set(listShared(householdId).map((s) => showKey(s.source, s.mediaId, s.mediaType)));
	if (!shared.size) return sum;

	const caches = new Map(members.map((m) => [m.id, showCache(m, ops)]));
	for (const from of members) {
		const since = (lastScan(from.id) ?? now) - LOOKBACK_MS;
		const plays = (await ops.recentPlays(from, since)).filter(
			(p) => shared.has(showKey(p.source, p.mediaId, p.mediaType)) && !isMirrored(from.id, p)
		);
		for (const to of members) {
			if (to.id === from.id) continue;
			await carry(from, to, plays, caches.get(to.id)!, hasViewing, ops, sum);
		}
		setLastScan(from.id, now);
	}
	return sum;
}

/**
 * The one-time catch-up when a show is first shared: each member's existing
 * plays of it go to anyone who hasn't watched that episode at all. Episodes
 * both of you have already seen (at whatever time) are left alone.
 */
export async function backfillShow(
	householdId: number,
	source: string,
	mediaId: string,
	ops: Ops = floppyOps,
	mediaType: SharedKind = 'tv'
): Promise<MirrorSummary> {
	const sum: MirrorSummary = { mirrored: 0, already: 0, failed: 0 };
	const members = mirrorMembers(householdId);
	if (members.length < 2) return sum;
	const caches = new Map(members.map((m) => [m.id, showCache(m, ops)]));
	// Read everyone's history first, so one person's backfilled plays aren't
	// mistaken for their own and carried straight back.
	const own = new Map<number, Play[]>();
	for (const m of members) own.set(m.id, [...(await caches.get(m.id)!(source, mediaId, mediaType))]);
	for (const from of members) {
		// Oldest first, capped: a long-running show is still a bounded catch-up.
		const plays = [...own.get(from.id)!].sort((a, b) => a.at - b.at).slice(0, 1000);
		for (const to of members) {
			if (to.id === from.id) continue;
			await carry(from, to, plays, caches.get(to.id)!, hasEpisode, ops, sum);
		}
	}
	return sum;
}
