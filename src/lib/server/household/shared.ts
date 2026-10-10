/**
 * The household's shared titles — the shows (and films) where a play by either
 * of you counts for both. Stored in Seek, one list per household. Mirroring itself is in mirror.ts.
 *
 * Shows are the common case, so `mediaType` defaults to 'tv' everywhere; a film
 * says 'movie'. The two are kept apart because TMDB numbers them separately — a
 * film and a show can share an id.
 */
import { db, nowIso } from '../db';

export type SharedKind = 'tv' | 'movie';
export type SharedShow = {
	source: string;
	mediaId: string;
	mediaType: SharedKind;
	title: string | null;
	addedBy: number | null;
	createdAt: string;
};
export type SharedRef = { source: string; mediaId: string; mediaType?: SharedKind; title?: string | null };

type Row = {
	media_type: SharedKind;
	source: string;
	media_id: string;
	title: string | null;
	added_by: number | null;
	created_at: string;
};
const toShow = (r: Row): SharedShow => ({
	source: r.source,
	mediaId: r.media_id,
	mediaType: r.media_type,
	title: r.title,
	addedBy: r.added_by,
	createdAt: r.created_at
});

/** One key per title. Shows keep the bare `source:id` they always had. */
export const showKey = (source: string, mediaId: string, mediaType: SharedKind = 'tv') =>
	mediaType === 'tv' ? `${source}:${mediaId}` : `${mediaType}:${source}:${mediaId}`;

export function listShared(householdId: number): SharedShow[] {
	return (
		db()
			.prepare('SELECT * FROM shared_shows WHERE household_id = ? ORDER BY created_at')
			.all(householdId) as Row[]
	).map(toShow);
}

export function sharedKeys(householdId: number): Set<string> {
	return new Set(listShared(householdId).map((s) => showKey(s.source, s.mediaId, s.mediaType)));
}

export function isShared(householdId: number, source: string, mediaId: string, mediaType: SharedKind = 'tv'): boolean {
	return Boolean(
		db()
			.prepare('SELECT 1 FROM shared_shows WHERE household_id = ? AND media_type = ? AND source = ? AND media_id = ?')
			.get(householdId, mediaType, source, mediaId)
	);
}

/** Share a title. Returns true when it wasn't shared before (so the caller can
 *  run the one-time backfill). */
export function share(householdId: number, userId: number, show: SharedRef): boolean {
	const res = db()
		.prepare(
			`INSERT INTO shared_shows (household_id, media_type, source, media_id, title, added_by, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
		)
		.run(householdId, show.mediaType ?? 'tv', show.source, show.mediaId, show.title ?? null, userId, nowIso());
	return res.changes > 0;
}

/** Stop sharing. Plays already carried over stay — they're real history now. */
export function unshare(householdId: number, source: string, mediaId: string, mediaType: SharedKind = 'tv'): void {
	db()
		.prepare('DELETE FROM shared_shows WHERE household_id = ? AND media_type = ? AND source = ? AND media_id = ?')
		.run(householdId, mediaType, source, mediaId);
}
