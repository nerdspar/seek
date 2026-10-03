/**
 * Discovery results joined with *your* library: Hardcover says what a book is,
 * BookOrbit says whether you own it and where you are in it. Kept apart from
 * both clients so each stays about one service.
 */
import {
	arrivedEntries,
	bookKey,
	favoriteGenres,
	librarySeeds,
	myBooks,
	notYours,
	recommendationSeeds,
	topGenres,
	withShelf,
	type BookCard,
	type BookRail,
	type EntryStatus,
	type MyBook,
	type ReadingBook
} from '$lib/books';
import { bookorbitLinked, getAllBooks, setBookRating, setReadStatus } from './bookorbit';
import { authorBooks, bookDetail, genreBooks, readShelf, searchBooks, seriesAfter } from './hardcover';
import { memo } from '../memo';
import { hardcoverUserToken } from '../userctx';
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

/* ── Personal shelves: "Because you read …" / "Because you like …" ───────────── */

/**
 * Recommendations grown from your own reading:
 * - "Because you read <book>": what comes next in its series, then more by its
 *   author — for your most-loved, most recent finishes;
 * - "Because you like <genre>": the most-read recent books in the genres you
 *   read most (genres from BookOrbit, or Hardcover for books it hasn't tagged).
 * What you've read and rated on your own Hardcover account (Your accounts)
 * counts too. With nothing finished or loved anywhere yet, it grows from the
 * books you added to the library most recently ("More like …").
 * Nothing you already have is recommended. Cached per person for a few hours;
 * empty (not an error) when there's nothing to grow from yet.
 */
export function personalRails(): Promise<BookRail[]> {
	return memo('books:personal', 6 * 60 * 60 * 1000, buildPersonalRails);
}

/** All your books — the library (when linked) and your own — as one list. A
 *  BookOrbit hiccup gives just your own books rather than an error. */
export async function myBookList(): Promise<MyBook[]> {
	const library = bookorbitLinked() ? await getAllBooks().catch(() => []) : [];
	return myBooks(library, listEntries());
}

/** Your Hardcover shelves, when you've linked your own token; [] otherwise or
 *  if Hardcover is unreachable — recommendations just grow from less. */
async function myShelf(): Promise<MyBook[]> {
	const token = hardcoverUserToken();
	return token ? readShelf(token).catch(() => []) : [];
}

async function buildPersonalRails(): Promise<BookRail[]> {
	const [own, shelf] = await Promise.all([myBookList(), myShelf()]);
	const books = withShelf(own, shelf);
	const loved = recommendationSeeds(books);
	const seeds = loved.length ? loved : librarySeeds(books);
	if (!seeds.length) return [];

	// A Hardcover id for each seed (BookOrbit may not have matched it yet).
	const withIds = await Promise.all(
		seeds.map(async (b) => ({ book: b, id: b.hardcoverId ?? (await matchHardcover(b.title, b.authors[0] ?? null).catch(() => null)) }))
	);

	const rails: BookRail[] = [];
	const used = new Set<number>();
	const authorsUsed = new Set<string>();
	for (const { book, id } of withIds) {
		if (rails.length >= 2) break;
		const author = book.authors[0];
		if (author && authorsUsed.has(author.toLowerCase())) continue;
		const [next, byAuthor] = await Promise.all([
			id ? seriesAfter(id).catch(() => []) : Promise.resolve([] as BookCard[]),
			author ? authorBooks(author).catch(() => []) : Promise.resolve([] as BookCard[])
		]);
		const picks = notYours([...next, ...byAuthor], books).filter((c) => c.hardcoverId !== id && !used.has(c.hardcoverId));
		const unique = picks.filter((c, i) => picks.findIndex((x) => x.hardcoverId === c.hardcoverId) === i).slice(0, 15);
		if (unique.length < 3) continue;
		unique.forEach((c) => used.add(c.hardcoverId));
		if (author) authorsUsed.add(author.toLowerCase());
		rails.push({
			key: `read-${book.key}`,
			title: loved.length ? `Because you read ${book.title}` : `More like ${book.title}`,
			subtitle: next.length ? 'What comes next, and more by the same author.' : `More by ${author}.`,
			books: unique
		});
	}

	// Genres: BookOrbit's when it has them, else Hardcover's for the seeds.
	const extra = new Map<string, string[]>();
	await Promise.all(
		withIds.map(async ({ book, id }) => {
			if (book.genres.length || !id) return;
			const d = await bookDetail(id).catch(() => null);
			if (d?.genres.length) extra.set(book.key, d.genres);
		})
	);
	const genres = favoriteGenres(books, extra);
	// Nothing read yet: the genres of what you own (and the seeds' looked-up ones).
	if (!genres.length) genres.push(...topGenres(seeds.map((b) => ({ ...b, genres: [...b.genres, ...(extra.get(b.key) ?? [])] })), 2));
	for (const genre of genres) {
		const { recent, popular } = await genreBooks(genre).catch(() => ({ recent: [], popular: [] }));
		const picks = notYours([...recent, ...popular], books).filter((c) => !used.has(c.hardcoverId)).slice(0, 15);
		if (picks.length < 3) continue;
		picks.forEach((c) => used.add(c.hardcoverId));
		rails.push({ key: `genre-${genre}`, title: `Because you like ${genre}`, subtitle: `Readers' favourites in ${genre}, newest first.`, books: picks });
	}
	return rails;
}

