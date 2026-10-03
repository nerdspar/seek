/**
 * Hardcover — book discovery only (docs/books-plan.md): shelves of books you may
 * not own yet, search across the whole catalog, and a book's detail. Everything
 * else about books (your list, progress, goals) is BookOrbit's.
 *
 * The catalog is public, so one token serves everyone and the caches here are
 * shared across users (unlike BookOrbit's). Hardcover allows 60 requests a
 * minute and a query depth of 3, so shelves come back in one aliased request and
 * everything is cached.
 */
import { HARDCOVER_TOKEN } from '$lib/server/env';
import { TTLCache } from '$lib/server/cache';
import {
	mapHardcoverBook,
	mapHardcoverDetail,
	mapHardcoverHit,
	type BookCard,
	type BookDetail,
	type BookRail
} from '$lib/books';

const ENDPOINT = 'https://api.hardcover.app/v1/graphql';

export const hardcoverConfigured = () => Boolean(HARDCOVER_TOKEN().trim());

export class HardcoverError extends Error {
	constructor(message: string) {
		super(`Hardcover: ${message}`);
		this.name = 'HardcoverError';
	}
}

/** The settings page hands out the token with or without the "Bearer " prefix. */
function authorization(): string {
	const t = HARDCOVER_TOKEN().trim();
	return /^bearer\s/i.test(t) ? t : `Bearer ${t}`;
}

async function hc<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
	if (!hardcoverConfigured()) throw new HardcoverError('not configured (HARDCOVER_TOKEN)');
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { Authorization: authorization(), 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ query, variables }),
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new HardcoverError(`HTTP ${res.status}`);
	const body = (await res.json()) as { data?: T; errors?: { message?: string }[] };
	// GraphQL reports failures in the body with a 200.
	if (body.errors?.length) throw new HardcoverError(body.errors[0].message ?? 'query failed');
	if (!body.data) throw new HardcoverError('empty response');
	return body.data;
}

/* Depth ≤ 3: cached_contributors is JSON (no depth), image { url } is depth 2. */
const BOOK_FIELDS = 'id title rating release_year release_date users_count cached_contributors image { url }';

const RAILS_QUERY = `query Rails($year: Int!, $ago: date!, $today: date!, $ahead: date!) {
  thisYear: books(where: {release_year: {_eq: $year}}, order_by: {users_count: desc}, limit: 20) { ${BOOK_FIELDS} }
  newest: books(where: {release_date: {_gte: $ago, _lte: $today}, users_count: {_gte: 30}}, order_by: {release_date: desc}, limit: 20) { ${BOOK_FIELDS} }
  soon: books(where: {release_date: {_gt: $today, _lte: $ahead}}, order_by: {users_count: desc}, limit: 20) { ${BOOK_FIELDS} }
  classics: books(order_by: {users_count: desc}, limit: 20) { ${BOOK_FIELDS} }
}`;

/* Shelves in display order. `soon` stops six months out: Hardcover carries
   placeholder dates years ahead (The Doors of Stone sits at 2030). */
const RAILS: { key: 'thisYear' | 'newest' | 'soon' | 'classics'; title: (y: number) => string; subtitle: string }[] = [
	{ key: 'thisYear', title: (y) => `Popular in ${y}`, subtitle: 'What readers are picking up this year.' },
	{ key: 'newest', title: () => 'New releases', subtitle: 'Out in the last two months.' },
	{ key: 'soon', title: () => 'Coming soon', subtitle: 'The most anticipated, out in the next six months.' },
	{ key: 'classics', title: () => 'All-time favorites', subtitle: 'The most-read books on Hardcover.' }
];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 24 * 60 * 60 * 1000;

/** Drop repeats and anything without a cover — a shelf of grey boxes reads as broken. */
function clean(cards: BookCard[]): BookCard[] {
	const seen = new Set<number>();
	return cards.filter((c) => {
		if (!c.coverUrl || !c.hardcoverId || seen.has(c.hardcoverId)) return false;
		seen.add(c.hardcoverId);
		return true;
	});
}

const railsCache = new TTLCache<BookRail[]>(60 * 60 * 1000, 4);

/** The Discover shelves. Keyed by day, so "new" and "soon" roll over at midnight. */
export async function discoverRails(now = new Date()): Promise<BookRail[]> {
	const today = ymd(now);
	const hit = railsCache.get(today);
	if (hit) return hit;

	const data = await hc<Record<string, unknown[]>>(RAILS_QUERY, {
		year: now.getFullYear(),
		ago: ymd(new Date(now.getTime() - 60 * DAY)),
		today,
		ahead: ymd(new Date(now.getTime() + 180 * DAY))
	});
	const rails = RAILS.map((r) => ({
		key: r.key,
		title: r.title(now.getFullYear()),
		subtitle: r.subtitle,
		books: clean((data[r.key] ?? []).map(mapHardcoverBook))
	})).filter((r) => r.books.length);
	railsCache.set(today, rails);
	return rails;
}

const searchCache = new TTLCache<BookCard[]>(10 * 60 * 1000, 200);

type Hits = { results?: { hits?: { document?: Record<string, unknown> }[] } };

/* User-created placeholder entries clutter Hardcover's catalog — searching an
   author's name ranks dozens of "James Patterson"-titled stubs (one reader, no
   cover) above every real book. A result with no cover AND almost no readers is
   one of those; a real but obscure book usually has one or the other. */
export function isStub(doc: Record<string, unknown>): boolean {
	const hasCover = Boolean((doc.image as { url?: unknown } | null)?.url);
	const readers = typeof doc.users_count === 'number' ? doc.users_count : 0;
	return !hasCover && readers < 3;
}

/**
 * Search the whole catalog. Two rankings in one request: relevance (precise for
 * titles — "dune" → the Dune books) and popularity (right for author names,
 * where relevance surfaces stubs). Relevance leads, stubs dropped; popularity
 * fills the rest. Real results without a cover stay — a search answer shouldn't
 * hide the exact book someone typed just because art is missing.
 */
export async function searchBooks(query: string, limit = 20): Promise<BookCard[]> {
	const q = query.trim();
	if (!q) return [];
	const key = `${limit}:${q.toLowerCase()}`;
	const hit = searchCache.get(key);
	if (hit) return hit;

	const data = await hc<{ relevance: Hits; popular: Hits }>(
		`query Search($q: String!, $n: Int!) {
			relevance: search(query: $q, query_type: "Book", per_page: $n) { results }
			popular: search(query: $q, query_type: "Book", per_page: $n, sort: "users_count:desc") { results }
		}`,
		{ q, n: limit }
	);
	const docs = [...(data.relevance.results?.hits ?? []), ...(data.popular.results?.hits ?? [])]
		.map((h) => h.document ?? {})
		.filter((d) => !isStub(d));
	const seen = new Set<number>();
	const cards = docs
		.map(mapHardcoverHit)
		.filter((c) => c.hardcoverId && !seen.has(c.hardcoverId) && seen.add(c.hardcoverId))
		.slice(0, limit);
	searchCache.set(key, cards);
	return cards;
}

const detailCache = new TTLCache<BookDetail | null>(6 * 60 * 60 * 1000, 500);

/** One book's detail for the sheet, or null when Hardcover has no such id. */
export async function bookDetail(id: number): Promise<BookDetail | null> {
	const hit = detailCache.get(String(id));
	if (hit !== undefined) return hit;
	const data = await hc<{ books_by_pk: unknown | null }>(
		`query Book($id: Int!) { books_by_pk(id: $id) {
			${BOOK_FIELDS} subtitle description pages ratings_count cached_tags
			book_series(limit: 1) { position series { name } }
		} }`,
		{ id }
	);
	const detail = data.books_by_pk ? mapHardcoverDetail(data.books_by_pk) : null;
	detailCache.set(String(id), detail);
	return detail;
}
