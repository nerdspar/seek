import { describe, it, expect } from 'vitest';
import { searchSections } from './searchView';

const base = {
	scope: 'best' as const,
	onListCount: 0,
	freshCount: 0,
	booksCount: 0,
	searching: false,
	bookSearching: false,
	failed: false
};

describe('searchSections', () => {
	it('shows all three kinds under All when each has results', () => {
		const s = searchSections({ ...base, onListCount: 2, freshCount: 5, booksCount: 3 });
		expect(s.showOnList).toBe(true);
		expect(s.showFresh).toBe(true);
		expect(s.showBooks).toBe(true);
		expect(s.showEmpty).toBe(false);
	});

	// The regression: a TMDB title-search failure must not hide books.
	it('still shows books when the TMDB search failed', () => {
		const s = searchSections({ ...base, freshCount: 0, booksCount: 4, failed: true });
		expect(s.showBooks).toBe(true);
		expect(s.showFresh).toBe(false);
		// And it must not also claim "nothing found" on top of the error banner.
		expect(s.showEmpty).toBe(false);
		expect(s.showSearching).toBe(false);
	});

	it('hides titles under the Books chip but keeps books', () => {
		const s = searchSections({ ...base, scope: 'books', onListCount: 3, freshCount: 3, booksCount: 2 });
		expect(s.showOnList).toBe(false);
		expect(s.showFresh).toBe(false);
		expect(s.showBooks).toBe(true);
	});

	it('spins only while settling with nothing to show yet', () => {
		expect(searchSections({ ...base, searching: true }).showSearching).toBe(true);
		expect(searchSections({ ...base, bookSearching: true }).showSearching).toBe(true);
		// Once a result is in, no spinner even if the other source is still loading.
		expect(searchSections({ ...base, booksCount: 1, searching: true }).showSearching).toBe(false);
	});

	it('reports empty only when settled, truly empty, and not errored', () => {
		expect(searchSections(base).showEmpty).toBe(true);
		expect(searchSections({ ...base, searching: true }).showEmpty).toBe(false);
		expect(searchSections({ ...base, failed: true }).showEmpty).toBe(false);
	});
});
