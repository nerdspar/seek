/**
 * The one-time move of reading state into Hardcover (docs/books-hardcover-plan.md).
 *
 * For each person with their own Hardcover token, once:
 * 1. Seek's old books outside the library (book_entries) — status, rating,
 *    dates and page;
 * 2. library books BookOrbit has a status or rating for.
 * Anything already on your Hardcover shelf is left exactly as it is (a
 * Goodreads import wins). A person is marked moved only when every book went
 * across; otherwise the next run retries what's left.
 */
import { db, nowIso } from '../db';
import { currentUser } from '../userctx';
import { bookorbitLinked, getAllBooks } from './bookorbit';
import { importBook, myShelf, shelfLinked, type ImportedBook } from './shelf';
import { listEntries } from './entries';
import type { BookReadStatus, EntryStatus, ReadingBook } from '$lib/books';

export type MoveResult = { added: number; already: number; failed: number } | { skipped: string };

const moved = (userId: number) => Boolean(db().prepare('SELECT 1 FROM books_moved WHERE user_id = ?').get(userId));

/** BookOrbit's statuses onto Hardcover's shelves. */
function shelfStatus(s: BookReadStatus): EntryStatus | null {
	if (s === 'rereading') return 'reading';
	if (s === 'skimmed') return 'read';
	if (s === 'unread') return null;
	return s;
}

/** What a library book should bring with it, if anything: a status, or a rating
 *  alone (you rate what you've read). */
export function fromLibraryBook(b: ReadingBook): ImportedBook | null {
	if (!b.hardcoverId) return null;
	const status = shelfStatus(b.status) ?? (b.rating !== null ? 'read' : null);
	if (!status) return null;
	return {
		hardcoverId: b.hardcoverId,
		status,
		rating: b.rating,
		startedAt: b.startedAt,
		finishedAt: b.finishedAt,
		progressPages: b.progress !== null && b.pageCount ? Math.round(b.progress * b.pageCount) : null
	};
}

/** Move this person's books into Hardcover, if they haven't been yet. */
export async function moveToHardcover(gapMs = 1100): Promise<MoveResult> {
	const me = currentUser();
	if (!me) return { skipped: 'no user' };
	if (!shelfLinked()) return { skipped: 'no Hardcover token' };
	if (moved(me.id)) return { skipped: 'already moved' };

	await myShelf(); // fails here (and retries next run) if Hardcover is down
	const library = bookorbitLinked() ? await getAllBooks() : [];
	const books = new Map<number, ImportedBook>();
	for (const b of library) {
		const i = fromLibraryBook(b);
		if (i) books.set(i.hardcoverId, i);
	}
	// Seek's own record wins over BookOrbit's for the same book.
	for (const e of listEntries()) books.set(e.hardcoverId, { ...e });

	const sum = { added: 0, already: 0, failed: 0 };
	for (const book of books.values()) {
		try {
			sum[await importBook(book)]++;
		} catch (err) {
			sum.failed++;
			console.warn(`[books] moving ${book.hardcoverId} to Hardcover failed:`, err);
		}
		// Well under Hardcover's 60 requests a minute.
		if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
	}
	if (!sum.failed) db().prepare('INSERT OR REPLACE INTO books_moved (user_id, moved_at) VALUES (?, ?)').run(me.id, nowIso());
	return sum;
}
