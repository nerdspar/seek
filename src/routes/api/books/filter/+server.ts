import { json, error } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { BOOK_GENRES, discoverBooks, hardcoverConfigured, type BookSort } from '$lib/server/books/hardcover';
import { markOwned, ownedIndex } from '$lib/server/books/discovery';
import type { RequestHandler } from './$types';

const SORTS: BookSort[] = ['popular', 'new', 'rating'];
const known = (g: string) => BOOK_GENRES.find((x) => x.toLowerCase() === g.toLowerCase());

/**
 * Browse the catalogue by genre(s), decade and sort — the Books scope's filter.
 * Returns a page of results with the books you already own badged, plus a total
 * for the live count, mirroring /api/discover/filter for shows and films.
 */
export const GET: RequestHandler = async ({ url }) => {
	const prefs = await getPrefs().catch(() => null);
	if (!prefs?.booksEnabled || !hardcoverConfigured()) error(404, 'Book discovery is not set up.');

	const q = url.searchParams;
	// Only genres Hardcover actually offers; unknown ones are dropped, not errored.
	const genres = (q.get('genres') ?? '')
		.split(',')
		.map((g) => g.trim())
		.filter(Boolean)
		.map(known)
		.filter((g): g is string => Boolean(g));
	const sortRaw = q.get('sort') ?? 'popular';
	const sort: BookSort = SORTS.includes(sortRaw as BookSort) ? (sortRaw as BookSort) : 'popular';
	const num = (k: string) => {
		const n = Number(q.get(k));
		return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
	};
	const page = Math.max(1, num('page') ?? 1);

	const { results, total } = await discoverBooks(
		{ genres, yearGte: num('yearGte'), yearLte: num('yearLte'), sort },
		page
	);
	const idx = await ownedIndex().catch(() => null);
	return json({ results: idx ? markOwned(results, idx) : results, total });
};
