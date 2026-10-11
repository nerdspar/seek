import { describe, it, expect } from 'vitest';
import { emptyBookFilter, bookFilterActive, toggleGenre, bookFilterQuery } from './bookFilter';

describe('bookFilter', () => {
	it('is inactive at its defaults', () => {
		expect(bookFilterActive(emptyBookFilter())).toBe(false);
	});

	it('is active once a genre, a decade or a non-default sort is set', () => {
		expect(bookFilterActive({ ...emptyBookFilter(), genres: ['Fantasy'] })).toBe(true);
		expect(bookFilterActive({ ...emptyBookFilter(), eras: ['2010s'] })).toBe(true);
		expect(bookFilterActive({ ...emptyBookFilter(), sort: 'new' })).toBe(true);
		expect(bookFilterActive({ ...emptyBookFilter(), sort: 'popular' })).toBe(false);
	});

	it('toggles a genre in and out', () => {
		expect(toggleGenre([], 'Fantasy')).toEqual(['Fantasy']);
		expect(toggleGenre(['Fantasy', 'Horror'], 'Fantasy')).toEqual(['Horror']);
	});

	it('serialises only what is set, spanning the chosen decades', () => {
		expect(bookFilterQuery(emptyBookFilter())).toBe('sort=popular');
		const q = new URLSearchParams(bookFilterQuery({ genres: ['Fantasy', 'Horror'], eras: ['2010s', '2020s'], sort: 'new' }));
		expect(q.get('sort')).toBe('new');
		expect(q.get('genres')).toBe('Fantasy,Horror');
		expect(q.get('yearGte')).toBe('2010');
		// 2020s is open-ended above, so no upper bound.
		expect(q.get('yearLte')).toBe(null);
	});
});
