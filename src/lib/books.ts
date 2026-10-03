/**
 * Books — shared types and pure mappers for the book subsystem (spec:
 * docs/books-plan.md). Discovery comes from Hardcover; the reading list, status,
 * progress, goals and stats come from the self-hosted BookOrbit. Everything here
 * is client-safe (no server imports) so the UI and the unit tests can use it.
 */

/** BookOrbit's reading-status enum (packages/types book.ts READ_STATUSES). */
export type BookReadStatus =
	| 'unread'
	| 'want_to_read'
	| 'reading'
	| 'on_hold'
	| 'rereading'
	| 'read'
	| 'skimmed'
	| 'abandoned';

/** A row on the reading list — one owned book in BookOrbit with its state. */
export type ReadingBook = {
	id: number;
	title: string;
	authors: string[];
	status: BookReadStatus;
	/** 0..1, or null when never opened. */
	progress: number | null;
	rating: number | null;
	pageCount: number | null;
	year: number | null;
	seriesName: string | null;
	seriesIndex: number | null;
	/** Seek-proxied cover (BookOrbit covers are auth-gated), or null. */
	coverUrl: string | null;
	/** Link to Hardcover, when BookOrbit matched an edition — lets Discover mark
	 *  a result as already owned. */
	hardcoverId: number | null;
};

/** A discovery result from Hardcover — a book you may not own yet. */
export type BookCard = {
	hardcoverId: number;
	title: string;
	author: string | null;
	/** Public Hardcover asset URL — safe to use directly in an <img>. */
	coverUrl: string | null;
	year: number | null;
	/** Community rating, 0..5, or null. */
	rating: number | null;
};

/** A discovery shelf (Popular this year, New releases, …). */
export type BookRail = { key: string; title: string; subtitle: string; books: BookCard[] };

/** Everything the book sheet shows about a Hardcover book. */
export type BookDetail = BookCard & {
	subtitle: string | null;
	description: string | null;
	pages: number | null;
	ratingsCount: number | null;
	/** How many Hardcover readers have it on a shelf — a popularity signal. */
	readers: number | null;
	genres: string[];
	moods: string[];
	series: { name: string; position: number | null } | null;
};

const STATUS_LABELS: Record<BookReadStatus, string> = {
	unread: 'In your library',
	want_to_read: 'Want to read',
	reading: 'Reading',
	on_hold: 'On hold',
	rereading: 'Rereading',
	read: 'Read',
	skimmed: 'Skimmed',
	abandoned: 'Did not finish'
};

export const statusLabel = (s: BookReadStatus) => STATUS_LABELS[s];

/** The badge on a discovery cover: your status if you own it, else whether
 *  it's on your wishlist, else nothing. */
export function cardBadge(c: { owned?: { status: BookReadStatus } | null; wished?: boolean }): string | null {
	if (c.owned) return statusLabel(c.owned.status);
	return c.wished ? 'Want to read' : null;
}

/** The reading list's sections, in order. Books you own but haven't started
 *  ("unread") aren't a section — they're the library, browsed separately. */
export const READING_SECTIONS: { title: string; statuses: BookReadStatus[] }[] = [
	{ title: 'Reading', statuses: ['reading', 'rereading'] },
	{ title: 'Want to read', statuses: ['want_to_read'] },
	{ title: 'On hold', statuses: ['on_hold'] },
	{ title: 'Read', statuses: ['read', 'skimmed'] },
	{ title: 'Did not finish', statuses: ['abandoned'] }
];

/** Group a library into the reading list's sections (empty ones dropped). */
export function groupReading(
	books: ReadingBook[]
): { title: string; books: ReadingBook[] }[] {
	return READING_SECTIONS.map((s) => ({
		title: s.title,
		books: books.filter((b) => s.statuses.includes(b.status))
	})).filter((s) => s.books.length);
}

/** A wishlisted book — wanted, not owned (Seek's own list, per person). */
export type WishBook = BookCard & { addedAt: string };

/** Wishlist entries you still don't own. Once a book lands in the library the
 *  library copy (with your real status) is the one to show. */
export function unownedWishes(wishlist: WishBook[], library: ReadingBook[]): WishBook[] {
	const ids = new Set(library.map((b) => b.hardcoverId).filter(Boolean));
	const keys = new Set(library.map((b) => bookKey(b.title, b.authors[0])));
	return wishlist.filter((w) => !ids.has(w.hardcoverId) && !keys.has(bookKey(w.title, w.author)));
}

export type ReadingSection = { title: string; books: ReadingBook[]; wishes: WishBook[] };

/** The reading list: status sections from the library, with the wishlist's
 *  not-yet-owned books folded into "Want to read". */
export function readingSections(library: ReadingBook[], wishlist: WishBook[]): ReadingSection[] {
	const wishes = unownedWishes(wishlist, library);
	return READING_SECTIONS.map((s) => ({
		title: s.title,
		books: library.filter((b) => s.statuses.includes(b.status)),
		wishes: s.title === 'Want to read' ? wishes : []
	})).filter((s) => s.books.length || s.wishes.length);
}

/**
 * The URL to draw a cover at a given CSS width. Covers come from two places,
 * neither of which serves sized images, so both go through Seek's thumbnailer
 * (server/images.ts) at 2× for retina: BookOrbit covers via the cover proxy's
 * `?w=`, Hardcover covers via /api/books/img. Anything else is used as-is.
 */
export function coverThumb(url: string | null, cssWidth: number): string | null {
	if (!url) return null;
	const w = Math.round(cssWidth * 2);
	if (url.startsWith('/api/books/cover/')) return `${url}?w=${w}`;
	if (url.startsWith('https://assets.hardcover.app/')) {
		return `/api/books/img?u=${encodeURIComponent(url)}&w=${w}`;
	}
	return url;
}

/* ── Matching a library book to a catalog book without an id ─────────────────
   BookOrbit only records a Hardcover id once it has matched the book, and until
   then the two sides can only be joined by what the book is called. Normalise
   both so cosmetic differences don't break the match — case, punctuation, a
   subtitle after the colon, a "(Series 14)" suffix — while different books stay
   different. */
export function normTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/\(.*?\)|\[.*?\]/g, ' ') // "(Women's Murder Club 14)"
		.split(/[:–—]/)[0] // "Dune: Deluxe Edition" → "dune"
		.replace(/^(the|a|an)\s+/, '')
		.replace(/&/g, 'and')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function normAuthor(author: string | null | undefined): string {
	return (author ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

/** The join key: normalised title + first author. */
export const bookKey = (title: string, author: string | null | undefined) =>
	`${normTitle(title)}|${normAuthor(author)}`;

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Author lists arrive as plain strings or as `{name}` objects depending on the
 *  source; accept either and drop anything empty. */
export function authorNames(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((a) => (typeof a === 'string' ? a : str(rec(a).name)))
		.filter((n): n is string => Boolean(n));
}

const READ_STATUSES: BookReadStatus[] = [
	'unread',
	'want_to_read',
	'reading',
	'on_hold',
	'rereading',
	'read',
	'skimmed',
	'abandoned'
];

/** A reading fraction in 0..1. BookOrbit may report a percent (0..100) or a
 *  fraction (0..1); normalise both, and clamp. */
export function normalizeProgress(v: unknown): number | null {
	const n = num(v);
	if (n === null) return null;
	const frac = n > 1 ? n / 100 : n;
	return Math.max(0, Math.min(1, frac));
}

/** Map one BookOrbit `/books/query` item to a reading-list row. */
export function mapReadingBook(raw: unknown): ReadingBook {
	const b = rec(raw);
	const id = num(b.id) ?? 0;
	const statusRaw = str(rec(b.readStatus).status);
	const status: BookReadStatus =
		statusRaw && (READ_STATUSES as string[]).includes(statusRaw)
			? (statusRaw as BookReadStatus)
			: 'unread';
	return {
		id,
		title: str(b.title) ?? 'Untitled',
		authors: authorNames(b.authors),
		status,
		progress: normalizeProgress(b.readingProgress),
		rating: num(b.rating),
		pageCount: num(b.pageCount),
		year: num(b.publishedYear),
		seriesName: str(b.seriesName),
		seriesIndex: num(b.seriesIndex),
		coverUrl: b.hasCover ? `/api/books/cover/${id}` : null,
		hardcoverId: num(b.hardcoverId)
	};
}

/** Map a Hardcover `books` query row (trending/new rails) to a discovery card. */
export function mapHardcoverBook(raw: unknown): BookCard {
	const b = rec(raw);
	const contributors = Array.isArray(b.cached_contributors) ? b.cached_contributors : [];
	const primary =
		contributors.find((c) => rec(c).primary) ?? contributors[0];
	return {
		hardcoverId: num(b.id) ?? 0,
		title: str(b.title) ?? 'Untitled',
		author: primary ? str(rec(rec(primary).author).name) : null,
		coverUrl: str(rec(b.image).url),
		year: num(b.release_year),
		rating: num(b.rating)
	};
}

/** Tag names from Hardcover's `cached_tags` for one category (Genre, Mood, …),
 *  deduplicated case-insensitively — the same tag often appears several ways. */
function tagNames(cached: unknown, category: string, max: number): string[] {
	const list = rec(cached)[category];
	if (!Array.isArray(list)) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of list) {
		const name = str(rec(t).tag);
		if (!name || seen.has(name.toLowerCase())) continue;
		seen.add(name.toLowerCase());
		out.push(name);
		if (out.length >= max) break;
	}
	return out;
}

/** Map a Hardcover `books_by_pk` result to the book sheet's detail. */
export function mapHardcoverDetail(raw: unknown): BookDetail {
	const b = rec(raw);
	const firstSeries = Array.isArray(b.book_series) ? rec(b.book_series[0]) : {};
	const seriesName = str(rec(firstSeries.series).name);
	return {
		...mapHardcoverBook(raw),
		subtitle: str(b.subtitle),
		description: str(b.description),
		pages: num(b.pages),
		ratingsCount: num(b.ratings_count),
		readers: num(b.users_count),
		genres: tagNames(b.cached_tags, 'Genre', 6),
		moods: tagNames(b.cached_tags, 'Mood', 4),
		series: seriesName ? { name: seriesName, position: num(firstSeries.position) } : null
	};
}

/** Map a Hardcover search hit `document` to a discovery card. */
export function mapHardcoverHit(raw: unknown): BookCard {
	const d = rec(raw);
	const names = Array.isArray(d.author_names) ? d.author_names : [];
	return {
		hardcoverId: Number(str(d.id) ?? num(d.id) ?? 0) || 0,
		title: str(d.title) ?? 'Untitled',
		author: str(names[0]),
		coverUrl: str(rec(d.image).url),
		year: num(d.release_year),
		rating: num(d.rating)
	};
}
