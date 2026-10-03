/**
 * "My books" outside the library — Seek's own record of a book you track that
 * isn't in BookOrbit: a physical copy you're reading, a library loan, one you
 * want. Your status, rating (1–5, like BookOrbit's) and page, per person.
 * BookOrbit only keeps state for books it holds; this covers everything else.
 *
 * Once the book lands in BookOrbit, its library copy takes over (see
 * discovery.settleArrivals, which carries the status and rating across).
 */
import { db, nowIso } from '../db';
import { currentUser } from '../userctx';
import type { BookCard, BookEntry, EntryStatus } from '$lib/books';
import { ENTRY_STATUSES } from '$lib/books';

type Row = {
	hardcover_id: number;
	title: string;
	author: string | null;
	cover_url: string | null;
	year: number | null;
	pages: number | null;
	status: EntryStatus;
	rating: number | null;
	progress_pages: number | null;
	started_at: string | null;
	finished_at: string | null;
	added_at: string;
	updated_at: string;
};

function me(): number {
	const u = currentUser();
	if (!u) throw new Error('Your books need a signed-in user.');
	return u.id;
}

const toEntry = (r: Row): BookEntry => ({
	hardcoverId: r.hardcover_id,
	title: r.title,
	author: r.author,
	coverUrl: r.cover_url,
	year: r.year,
	rating: null,
	pages: r.pages,
	status: r.status,
	myRating: r.rating,
	progressPages: r.progress_pages,
	startedAt: r.started_at,
	finishedAt: r.finished_at,
	addedAt: r.added_at,
	updatedAt: r.updated_at
});

/** Your books, most recently changed first. */
export function listEntries(): BookEntry[] {
	return (
		db().prepare('SELECT * FROM book_entries WHERE user_id = ? ORDER BY updated_at DESC').all(me()) as Row[]
	).map(toEntry);
}

export function getEntry(hardcoverId: number): BookEntry | null {
	const r = db().prepare('SELECT * FROM book_entries WHERE user_id = ? AND hardcover_id = ?').get(me(), hardcoverId) as
		| Row
		| undefined;
	return r ? toEntry(r) : null;
}

/** Hardcover id → your status, for badging discovery covers. */
export function entryStatuses(): Map<number, EntryStatus> {
	const rows = db().prepare('SELECT hardcover_id, status FROM book_entries WHERE user_id = ?').all(me()) as {
		hardcover_id: number;
		status: EntryStatus;
	}[];
	return new Map(rows.map((r) => [r.hardcover_id, r.status]));
}

export type EntryChange = {
	status?: EntryStatus;
	/** 1–5, or null to clear. */
	rating?: number | null;
	/** Pages read so far, or null to clear. */
	progressPages?: number | null;
};

type Book = Pick<BookCard, 'hardcoverId' | 'title' | 'author' | 'coverUrl' | 'year'> & { pages?: number | null };

/**
 * Track a book or change how you're tracking it. A new book needs a status
 * (default: want to read). Dates follow the status: starting it stamps
 * started_at, finishing it stamps finished_at (and fills the page count).
 */
export function saveEntry(book: Book, change: EntryChange = {}): BookEntry {
	if (!Number.isInteger(book.hardcoverId) || book.hardcoverId <= 0) throw new Error('A Hardcover id is required.');
	if (!book.title?.trim()) throw new Error('A title is required.');
	if (change.status !== undefined && !ENTRY_STATUSES.includes(change.status)) throw new Error('Unknown status.');
	if (change.rating != null && (!Number.isInteger(change.rating) || change.rating < 1 || change.rating > 5)) {
		throw new Error('A rating is 1 to 5.');
	}
	if (change.progressPages != null && (!Number.isInteger(change.progressPages) || change.progressPages < 0)) {
		throw new Error('Pages read must be a whole number.');
	}

	const user = me();
	const now = nowIso();
	const before = getEntry(book.hardcoverId);
	const status = change.status ?? before?.status ?? 'want_to_read';
	const pages = book.pages ?? before?.pages ?? null;
	const startedAt =
		before?.startedAt ?? (status === 'reading' || status === 'read' || status === 'abandoned' ? now : null);
	const finishedAt = status === 'read' ? (before?.status === 'read' ? before.finishedAt : now) : null;
	let progress = change.progressPages !== undefined ? change.progressPages : (before?.progressPages ?? null);
	if (status === 'read' && pages) progress = pages;
	if (progress != null && pages) progress = Math.min(progress, pages);
	const rating = change.rating !== undefined ? change.rating : (before?.myRating ?? null);

	db()
		.prepare(
			`INSERT INTO book_entries (user_id, hardcover_id, title, author, cover_url, year, pages, status, rating,
			   progress_pages, started_at, finished_at, added_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(user_id, hardcover_id) DO UPDATE SET
			   title = excluded.title, author = excluded.author, cover_url = excluded.cover_url,
			   year = excluded.year, pages = excluded.pages, status = excluded.status, rating = excluded.rating,
			   progress_pages = excluded.progress_pages, started_at = excluded.started_at,
			   finished_at = excluded.finished_at, updated_at = excluded.updated_at`
		)
		.run(
			user,
			book.hardcoverId,
			book.title.trim(),
			book.author ?? null,
			book.coverUrl ?? null,
			book.year ?? null,
			pages,
			status,
			rating,
			progress,
			startedAt,
			finishedAt,
			before?.addedAt ?? now,
			now
		);
	return getEntry(book.hardcoverId)!;
}

/** Stop tracking a book. */
export function removeEntry(hardcoverId: number): void {
	db().prepare('DELETE FROM book_entries WHERE user_id = ? AND hardcover_id = ?').run(me(), hardcoverId);
}
