/**
 * Discovery results joined with *your* library: Hardcover says what a book is,
 * BookOrbit says whether you own it and where you are in it. Kept apart from
 * both clients so each stays about one service.
 */
import { arrivedWishes, bookKey, type BookCard, type BookRail, type ReadingBook } from '$lib/books';
import { bookorbitLinked, getAllBooks, setReadStatus } from './bookorbit';
import { searchBooks } from './hardcover';
import { listWishlist, removeFromWishlist, wishlistIds } from './wishlist';

/** What the UI needs to badge a discovery card you already own. */
export type Owned = { bookId: number; status: ReadingBook['status']; progress: number | null };

/** `wished`: on your wishlist (and not owned — owning it supersedes the wish). */
export type OwnedCard = BookCard & { owned: Owned | null; wished: boolean };

/* Your library two ways: by Hardcover id (exact, once BookOrbit has matched the
   book) and by normalised title + author (the fallback until it has — on a
   fresh library none have ids yet). Plus the Hardcover ids on your wishlist. */
export type OwnedIndex = {
	byHc: Map<number, ReadingBook>;
	byKey: Map<string, ReadingBook>;
	wished: Set<number>;
};

export function indexLibrary(books: ReadingBook[], wished: Set<number> = new Set()): OwnedIndex {
	const byHc = new Map<number, ReadingBook>();
	const byKey = new Map<string, ReadingBook>();
	for (const b of books) {
		if (b.hardcoverId) byHc.set(b.hardcoverId, b);
		byKey.set(bookKey(b.title, b.authors[0]), b);
	}
	return { byHc, byKey, wished };
}

export function markOwned(cards: BookCard[], idx: OwnedIndex): OwnedCard[] {
	return cards.map((c) => {
		const mine = idx.byHc.get(c.hardcoverId) ?? idx.byKey.get(bookKey(c.title, c.author));
		return {
			...c,
			owned: mine ? { bookId: mine.id, status: mine.status, progress: mine.progress } : null,
			wished: !mine && idx.wished.has(c.hardcoverId)
		};
	});
}

/** Your library index, or an empty one if you haven't linked BookOrbit or it's
 *  down — discovery must never fail just because the badge can't be computed.
 *  The wishlist is Seek's own, so it counts even without BookOrbit. */
export async function ownedIndex(): Promise<OwnedIndex> {
	const wished = wishlistIds();
	if (!bookorbitLinked()) return indexLibrary([], wished);
	return getAllBooks()
		.then((books) => indexLibrary(books, wished))
		.catch(() => indexLibrary([], wished));
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
 * A wished-for (or requested) book that has landed in the library comes in as
 * "unread" — BookOrbit doesn't know you wanted it. Carry the wish over: mark it
 * Want to read for you, then drop it from the wishlist, since the library copy
 * now carries your status. A copy you'd already given a status keeps it.
 * Best-effort: a failed write leaves the wish for next time.
 */
export async function settleArrivals(library: ReadingBook[]): Promise<ReadingBook[]> {
	const arrived = arrivedWishes(listWishlist(), library);
	if (!arrived.length) return library;
	const updated = new Map<number, ReadingBook>();
	for (const { wish, book } of arrived) {
		try {
			if (book.status === 'unread') {
				await setReadStatus(book.id, 'want_to_read');
				updated.set(book.id, { ...book, status: 'want_to_read' });
			}
			removeFromWishlist(wish.hardcoverId);
		} catch {
			/* leave it wished; try again on the next visit */
		}
	}
	return library.map((b) => updated.get(b.id) ?? b);
}
