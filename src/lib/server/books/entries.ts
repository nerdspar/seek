/**
 * Seek's old record of books outside the library (`book_entries`), from before
 * reading state moved to Hardcover (docs/books-hardcover-plan.md). Read only by
 * the one-time move (moveToHardcover.ts); the table is dropped in a later
 * release, once everyone's books have moved.
 */
import { db } from '../db';
import { currentUser } from '../userctx';
import type { EntryStatus } from '$lib/books';

/** One of your old Seek-only books, as stored. */
export type LegacyEntry = {
	hardcoverId: number;
	title: string;
	status: EntryStatus;
	rating: number | null;
	progressPages: number | null;
	startedAt: string | null;
	finishedAt: string | null;
};

type Row = {
	hardcover_id: number;
	title: string;
	status: EntryStatus;
	rating: number | null;
	progress_pages: number | null;
	started_at: string | null;
	finished_at: string | null;
};

/** Your old Seek-only books. */
export function listEntries(): LegacyEntry[] {
	const u = currentUser();
	if (!u) throw new Error('Your books need a signed-in user.');
	return (db().prepare('SELECT * FROM book_entries WHERE user_id = ? ORDER BY added_at').all(u.id) as Row[]).map((r) => ({
		hardcoverId: r.hardcover_id,
		title: r.title,
		status: r.status,
		rating: r.rating,
		progressPages: r.progress_pages,
		startedAt: r.started_at,
		finishedAt: r.finished_at
	}));
}
