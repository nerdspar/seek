/**
 * Discovery results joined with *your* books: Hardcover says what a book is,
 * your Hardcover shelf says where you are with it, and BookOrbit says whether
 * it's in the library (docs/books-hardcover-plan.md). Kept apart from the
 * clients so each stays about one service.
 */
import {
	bookKey,
	favoriteGenres,
	librarySeeds,
	myBooks,
	notYours,
	recommendationSeeds,
	topGenres,
	type BookCard,
	type BookRail,
	type BookReadStatus,
	type EntryStatus,
	type MyBook
} from '$lib/books';
import { bookorbitLinked, getAllBooks } from './bookorbit';
import { authorBooks, bookDetail, genreBooks, searchBooks, seriesAfter } from './hardcover';
import { myShelf, shelfLinked } from './shelf';
import { memo } from '../memo';

/** What the UI needs to badge a discovery card that's in the library. */
export type Owned = {
	bookId: number;
	/** Your status on it ('unread': in the library, not on your shelf). */
	status: BookReadStatus;
	progress: number | null;
	/** Your rating (1–5) and the page count, for the book sheet. */
	rating: number | null;
	pages: number | null;
};

/** `mine`: your status on a book that isn't in the library (owning it
 *  supersedes that — `owned` carries the status then). */
export type OwnedCard = BookCard & { owned: Owned | null; mine: EntryStatus | null };

/* Your books two ways: by Hardcover id (exact) and by normalised title + author
   (for a library book BookOrbit hasn't matched to Hardcover yet). */
export type OwnedIndex = { byHc: Map<number, MyBook>; byKey: Map<string, MyBook> };

export function indexBooks(books: MyBook[]): OwnedIndex {
	const byHc = new Map<number, MyBook>();
	const byKey = new Map<string, MyBook>();
	for (const b of books) {
		if (b.hardcoverId) byHc.set(b.hardcoverId, b);
		byKey.set(bookKey(b.title, b.authors[0]), b);
	}
	return { byHc, byKey };
}

export function markOwned(cards: BookCard[], idx: OwnedIndex): OwnedCard[] {
	return cards.map((c) => {
		const b = idx.byHc.get(c.hardcoverId) ?? idx.byKey.get(bookKey(c.title, c.author)) ?? null;
		const lib = b?.source === 'library' && b.libraryId !== null ? b : null;
		return {
			...c,
			owned: lib ? { bookId: lib.libraryId!, status: lib.status, progress: lib.progress, rating: lib.myRating, pages: lib.pages } : null,
			mine: b && !lib ? (b.status as EntryStatus) : null
		};
	});
}

/** Your books as a lookup, or an empty one if Hardcover or BookOrbit is down —
 *  discovery must never fail just because a badge can't be computed. */
export async function ownedIndex(): Promise<OwnedIndex> {
	return myBookList()
		.then(indexBooks)
		.catch(() => indexBooks([]));
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

/* ── Personal shelves: "Because you read …" / "Because you like …" ───────────── */

/**
 * Recommendations grown from your own reading:
 * - "Because you read <book>": what comes next in its series, then more by its
 *   author — for your most-loved, most recent finishes;
 * - "Because you like <genre>": the most-read recent books in the genres you
 *   read most (genres from BookOrbit, or Hardcover for books it hasn't tagged).
 * Everything on your Hardcover shelf counts (her Goodreads history included).
 * With nothing finished or loved anywhere yet, it grows from the books added
 * to the library most recently ("More like …").
 * Nothing you already have is recommended. Cached per person for a few hours;
 * empty (not an error) when there's nothing to grow from yet.
 */
export function personalRails(): Promise<BookRail[]> {
	return memo('books:personal', 6 * 60 * 60 * 1000, buildPersonalRails);
}

/** All your books — your Hardcover shelf joined to the library — as one list.
 *  A BookOrbit hiccup gives just your shelf; a Hardcover problem is an error
 *  (the reading list can't be shown without it). Without your own Hardcover
 *  token linked it's just the library, all "not started". */
export async function myBookList(): Promise<MyBook[]> {
	const [library, shelf] = await Promise.all([
		bookorbitLinked() ? getAllBooks().catch(() => []) : Promise.resolve([]),
		shelfLinked() ? myShelf() : Promise.resolve([])
	]);
	return myBooks(library, shelf);
}

async function buildPersonalRails(): Promise<BookRail[]> {
	// Recommendations grow from less (rather than fail) when a service is down.
	const books = await myBookList().catch(() => [] as MyBook[]);
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

