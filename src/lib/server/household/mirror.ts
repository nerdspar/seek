/**
 * Shared shows and films (§11): a play by either of you counts for both. With
 * plays in Seek this is direct — a mark on a shared title writes a play for
 * each of you at once (tracking/write.ts `watchers`), so there is no timer and
 * nothing to reconcile. What's left here is the one-time catch-up when a title
 * is first shared: each of you gets the other's plays of episodes you haven't
 * seen, and it lands on both lists.
 */
import { db } from '../db';
import { listMembers, type User } from '../users';
import { ensureTracked, recordPlay, tmdbIdOf } from '../tracking/write';
import type { SharedKind } from './shared';

export type MirrorSummary = { mirrored: number; already: number; failed: number };

/** Who sharing is between: everyone in the household. */
export function mirrorMembers(householdId: number): User[] {
	return listMembers(householdId);
}

type PlayRow = { user_id: number; season: number | null; episode: number | null; watched_at: string };
const epKey = (p: { season: number | null; episode: number | null }) => `${p.season}:${p.episode}`;

/** The catch-up for a newly shared title. */
export function backfillShow(householdId: number, source: string, mediaId: string, kind: SharedKind = 'tv'): MirrorSummary {
	const sum: MirrorSummary = { mirrored: 0, already: 0, failed: 0 };
	const id = tmdbIdOf(source, mediaId);
	const members = mirrorMembers(householdId);
	if (id === null || members.length < 2) return sum;
	const plays = db()
		.prepare(
			`SELECT user_id, season, episode, watched_at FROM plays WHERE media_type = ? AND tmdb_id = ? AND user_id IN (${members.map(() => '?').join(',')})
			ORDER BY watched_at, id`
		)
		.all(kind, id, ...members.map((m) => m.id)) as PlayRow[];
	// What each person had before the catch-up, so nothing is carried back.
	const had = new Map(members.map((m) => [m.id, new Set(plays.filter((p) => p.user_id === m.id).map(epKey))]));
	const given = new Map(members.map((m) => [m.id, new Set<string>()]));
	for (const p of plays) {
		for (const m of members) {
			if (m.id === p.user_id) continue;
			const k = epKey(p);
			if (had.get(m.id)!.has(k) || given.get(m.id)!.has(k)) {
				sum.already++;
				continue;
			}
			try {
				recordPlay(m.id, kind, id, p.season, p.episode, p.watched_at);
				given.get(m.id)!.add(k);
				sum.mirrored++;
			} catch {
				sum.failed++;
			}
		}
	}
	// On both lists, even with nothing watched yet.
	const trackers = db().prepare('SELECT 1 FROM tracked WHERE media_type = ? AND tmdb_id = ? AND user_id = ?');
	if (members.some((m) => trackers.get(kind, id, m.id))) for (const m of members) ensureTracked(m.id, kind, id);
	return sum;
}
