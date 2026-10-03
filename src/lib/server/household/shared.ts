/**
 * The household's shared shows — the ones where a play by either of you counts
 * for both. Stored in Seek (not Floppy tags: those don't work on grouped anime),
 * one list per household. Mirroring itself is in mirror.ts.
 */
import { db, nowIso } from '../db';

export type SharedShow = { source: string; mediaId: string; title: string | null; addedBy: number | null; createdAt: string };

type Row = { source: string; media_id: string; title: string | null; added_by: number | null; created_at: string };
const toShow = (r: Row): SharedShow => ({
	source: r.source,
	mediaId: r.media_id,
	title: r.title,
	addedBy: r.added_by,
	createdAt: r.created_at
});

export const showKey = (source: string, mediaId: string) => `${source}:${mediaId}`;

export function listShared(householdId: number): SharedShow[] {
	return (
		db()
			.prepare('SELECT * FROM shared_shows WHERE household_id = ? ORDER BY created_at')
			.all(householdId) as Row[]
	).map(toShow);
}

export function sharedKeys(householdId: number): Set<string> {
	return new Set(listShared(householdId).map((s) => showKey(s.source, s.mediaId)));
}

export function isShared(householdId: number, source: string, mediaId: string): boolean {
	return Boolean(
		db()
			.prepare('SELECT 1 FROM shared_shows WHERE household_id = ? AND source = ? AND media_id = ?')
			.get(householdId, source, mediaId)
	);
}

/** Share a show. Returns true when it wasn't shared before (so the caller can
 *  run the one-time backfill). */
export function share(householdId: number, userId: number, show: { source: string; mediaId: string; title?: string | null }): boolean {
	const res = db()
		.prepare(
			`INSERT INTO shared_shows (household_id, source, media_id, title, added_by, created_at)
			 VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
		)
		.run(householdId, show.source, show.mediaId, show.title ?? null, userId, nowIso());
	return res.changes > 0;
}

/** Stop sharing. Plays already carried over stay — they're real history now. */
export function unshare(householdId: number, source: string, mediaId: string): void {
	db()
		.prepare('DELETE FROM shared_shows WHERE household_id = ? AND source = ? AND media_id = ?')
		.run(householdId, source, mediaId);
}
