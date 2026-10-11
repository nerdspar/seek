/**
 * The Books discover filter — genre(s), a decade window and a sort — the book
 * parallel to discoverFilter.ts. Hardcover has no people/keyword/service facets,
 * so this is the smaller set it can actually browse by. Pure, so the sheet (that
 * builds it) and the endpoint (that reads it) agree, and it's testable.
 */
import { ERAS } from './discoverFilter';

export type BookDiscoverSort = 'popular' | 'new' | 'rating';

export type BookFilter = {
	/** BOOK_GENRES names, combined with AND (a book must carry all of them). */
	genres: string[];
	/** A decade window, or open-ended. */
	yearGte: number | null;
	yearLte: number | null;
	sort: BookDiscoverSort;
};

export const emptyBookFilter = (): BookFilter => ({ genres: [], yearGte: null, yearLte: null, sort: 'popular' });

/** Anything chosen beyond the defaults? Drives whether the scope browses. */
export function bookFilterActive(f: BookFilter): boolean {
	return f.genres.length > 0 || f.yearGte !== null || f.yearLte !== null || f.sort !== 'popular';
}

/** The decade chips are shared with TV/Movies (ERAS); which one is selected. */
export const bookEraId = (f: BookFilter): string | null =>
	ERAS.find((e) => e.gte === f.yearGte && e.lte === f.yearLte)?.id ?? null;

export function toggleGenre(genres: string[], g: string): string[] {
	return genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g];
}

/** The filter as query params for /api/books/filter. */
export function bookFilterQuery(f: BookFilter): string {
	const q = new URLSearchParams({ sort: f.sort });
	if (f.genres.length) q.set('genres', f.genres.join(','));
	if (f.yearGte !== null) q.set('yearGte', String(f.yearGte));
	if (f.yearLte !== null) q.set('yearLte', String(f.yearLte));
	return q.toString();
}
