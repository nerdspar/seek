/**
 * Discovery results joined with *your* library: Hardcover says what a book is,
 * BookOrbit says whether you own it and where you are in it. Kept apart from
 * both clients so each stays about one service.
 */
import { bookKey, type BookCard, type BookRail, type ReadingBook } from '$lib/books';
import { bookorbitLinked, getAllBooks } from './bookorbit';
import { searchBooks } from './hardcover';

/** What the UI needs to badge a discovery card you already own. */
export type Owned = { bookId: number; status: ReadingBook['status']; progress: number | null };

export type OwnedCard = BookCard & { owned: Owned | null };

/* Your library two ways: by Hardcover id (exact, once BookOrbit has matched the
   book) and by normalised title + author (the fallback until it has — on a
   fresh library none have ids yet). */
export type OwnedIndex = { byHc: Map<number, ReadingBook>; byKey: Map<string, ReadingBook> };

export function indexLibrary(books: ReadingBook[]): OwnedIndex {
	const byHc = new Map<number, ReadingBook>();
	const byKey = new Map<string, ReadingBook>();
	for (const b of books) {
		if (b.hardcoverId) byHc.set(b.hardcoverId, b);
		byKey.set(bookKey(b.title, b.authors[0]), b);
	}
	return { byHc, byKey };
}

const EMPTY: OwnedIndex = { byHc: new Map(), byKey: new Map() };

export function markOwned(cards: BookCard[], idx: OwnedIndex): OwnedCard[] {
	return cards.map((c) => {
		const mine = idx.byHc.get(c.hardcoverId) ?? idx.byKey.get(bookKey(c.title, c.author));
		return { ...c, owned: mine ? { bookId: mine.id, status: mine.status, progress: mine.progress } : null };
	});
}

/** Your library index, or an empty one if you haven't linked BookOrbit or it's
 *  down — discovery must never fail just because the badge can't be computed. */
export async function ownedIndex(): Promise<OwnedIndex> {
	if (!bookorbitLinked()) return EMPTY;
	return getAllBooks()
		.then(indexLibrary)
		.catch(() => EMPTY);
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
