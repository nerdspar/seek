/**
 * The Books discover filter — genre(s), a decade window and a sort — the book
 * parallel to discoverFilter.ts. Hardcover has no people/keyword/service facets,
 * so this is the smaller set it can actually browse by. Pure, so the sheet (that
 * builds it) and the endpoint (that reads it) agree, and it's testable.
 */
import { eraBounds } from './discoverFilter';

export type BookDiscoverSort = 'popular' | 'new' | 'rating';

export type BookFilter = {
	/** BOOK_GENRES names, combined with AND (a book must carry all of them). */
	genres: string[];
	/** Decade chips chosen (ERAS ids); multiple select the span between them. */
	eras: string[];
	sort: BookDiscoverSort;
};

export const emptyBookFilter = (): BookFilter => ({ genres: [], eras: [], sort: 'popular' });

/** Anything chosen beyond the defaults? Drives whether the scope browses. */
export function bookFilterActive(f: BookFilter): boolean {
	return f.genres.length > 0 || f.eras.length > 0 || f.sort !== 'popular';
}

export function toggleGenre(genres: string[], g: string): string[] {
	return genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g];
}

/** The filter as query params for /api/books/filter. */
export function bookFilterQuery(f: BookFilter): string {
	const q = new URLSearchParams({ sort: f.sort });
	if (f.genres.length) q.set('genres', f.genres.join(','));
	const { gte, lte } = eraBounds(f.eras);
	if (gte !== null) q.set('yearGte', String(gte));
	if (lte !== null) q.set('yearLte', String(lte));
	return q.toString();
}
