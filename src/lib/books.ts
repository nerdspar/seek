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
