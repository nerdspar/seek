/**
 * Discovery results joined with *your* library: Hardcover says what a book is,
 * BookOrbit says whether you own it and where you are in it. Kept apart from
 * both clients so each stays about one service.
 */
import { arrivedEntries, bookKey, type BookCard, type BookRail, type EntryStatus, type ReadingBook } from '$lib/books';
import { bookorbitLinked, getAllBooks, setBookRating, setReadStatus } from './bookorbit';
import { searchBooks } from './hardcover';
import { entryStatuses, listEntries, removeEntry } from './entries';

/** What the UI needs to badge a discovery card you already own. */
export type Owned = {
	bookId: number;
	status: ReadingBook['status'];
	progress: number | null;
	/** Your rating (1–5) and the page count, for the book sheet. */
	rating: number | null;
	pages: number | null;
};

/** `mine`: your status on it as one of your own books (not owned — owning it
 *  supersedes that). */
export type OwnedCard = BookCard & { owned: Owned | null; mine: EntryStatus | null };

/* Your library two ways: by Hardcover id (exact, once BookOrbit has matched the
   book) and by normalised title + author (the fallback until it has — on a
   fresh library none have ids yet). Plus your statuses on books you don't own. */
export type OwnedIndex = {
	byHc: Map<number, ReadingBook>;
	byKey: Map<string, ReadingBook>;
	mine: Map<number, EntryStatus>;
};

export function indexLibrary(books: ReadingBook[], mine: Map<number, EntryStatus> = new Map()): OwnedIndex {
	const byHc = new Map<number, ReadingBook>();
	const byKey = new Map<string, ReadingBook>();
	for (const b of books) {
		if (b.hardcoverId) byHc.set(b.hardcoverId, b);
		byKey.set(bookKey(b.title, b.authors[0]), b);
	}
	return { byHc, byKey, mine };
}

export function markOwned(cards: BookCard[], idx: OwnedIndex): OwnedCard[] {
	return cards.map((c) => {
		const lib = idx.byHc.get(c.hardcoverId) ?? idx.byKey.get(bookKey(c.title, c.author));
		return {
			...c,
			owned: lib
				? { bookId: lib.id, status: lib.status, progress: lib.progress, rating: lib.rating, pages: lib.pageCount }
				: null,
			mine: lib ? null : (idx.mine.get(c.hardcoverId) ?? null)
		};
	});
}

/** Your library index, or an empty one if you haven't linked BookOrbit or it's
 *  down — discovery must never fail just because the badge can't be computed.
 *  Your own books are Seek's, so they count even without BookOrbit. */
export async function ownedIndex(): Promise<OwnedIndex> {
	const mine = entryStatuses();
	if (!bookorbitLinked()) return indexLibrary([], mine);
	return getAllBooks()
		.then((books) => indexLibrary(books, mine))
		.catch(() => indexLibrary([], mine));
}

export async function railsWithOwned(
	rails: BookRail[]
): Promise<(Omit<BookRail, 'books'> & { books: OwnedCard[] })[]> {
	const idx = await ownedIndex();
	return rails.map((r) => ({ ...r, books: markOwned(r.books, idx) }));
}

/**
 * The Hardcover book that a library book (with no Hardcover id yet) is, if it
 * can be told for sure: the top search hits for "title author", accepted only
 * when the normalised title and author match exactly. A wrong description is
 * worse than none, so anything less certain is null.
 */
export async function matchHardcover(title: string, author: string | null): Promise<number | null> {
	const want = bookKey(title, author);
	const hits = await searchBooks([title, author].filter(Boolean).join(' '), 5);
	return hits.find((h) => bookKey(h.title, h.author) === want)?.hardcoverId ?? null;
}

/**
 * One of your own books that has landed in the library (you requested it, or
 * uploaded your copy) comes in as "unread" — BookOrbit doesn't know what you'd
 * done with it. Carry it over: your status and rating move to the library
 * copy, then your entry goes, since the library copy now carries them. A copy
 * you'd already given a status or rating keeps it. Best-effort: a failed write
 * leaves the entry for next time.
 */
export async function settleArrivals(library: ReadingBook[]): Promise<ReadingBook[]> {
	const arrived = arrivedEntries(listEntries(), library);
	if (!arrived.length) return library;
	const updated = new Map<number, ReadingBook>();
	for (const { entry, book } of arrived) {
		try {
			let next = book;
			if (book.status === 'unread') {
				await setReadStatus(book.id, entry.status);
				next = { ...next, status: entry.status };
			}
			if (book.rating === null && entry.myRating !== null) {
				await setBookRating(book.id, entry.myRating);
				next = { ...next, rating: entry.myRating };
			}
			updated.set(book.id, next);
			removeEntry(entry.hardcoverId);
		} catch {
			/* keep the entry; try again on the next visit */
		}
	}
	return library.map((b) => updated.get(b.id) ?? b);
}
