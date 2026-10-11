import { describe, it, expect } from 'vitest';
import { emptyBookFilter, bookFilterActive, bookEraId, toggleGenre, bookFilterQuery } from './bookFilter';

describe('bookFilter', () => {
	it('is inactive at its defaults', () => {
		expect(bookFilterActive(emptyBookFilter())).toBe(false);
	});

	it('is active once a genre, a decade or a non-default sort is set', () => {
		expect(bookFilterActive({ ...emptyBookFilter(), genres: ['Fantasy'] })).toBe(true);
		expect(bookFilterActive({ ...emptyBookFilter(), yearGte: 2010, yearLte: 2019 })).toBe(true);
		expect(bookFilterActive({ ...emptyBookFilter(), sort: 'new' })).toBe(true);
		expect(bookFilterActive({ ...emptyBookFilter(), sort: 'popular' })).toBe(false);
	});

	it('maps a decade window to an era id', () => {
		expect(bookEraId({ ...emptyBookFilter(), yearGte: 2010, yearLte: 2019 })).toBe('2010s');
		expect(bookEraId({ ...emptyBookFilter(), yearGte: null, yearLte: 1989 })).toBe('older');
		expect(bookEraId(emptyBookFilter())).toBe(null);
	});

	it('toggles a genre in and out', () => {
		expect(toggleGenre([], 'Fantasy')).toEqual(['Fantasy']);
		expect(toggleGenre(['Fantasy', 'Horror'], 'Fantasy')).toEqual(['Horror']);
	});

	it('serialises only what is set', () => {
		expect(bookFilterQuery(emptyBookFilter())).toBe('sort=popular');
		expect(bookFilterQuery({ genres: ['Fantasy', 'Horror'], yearGte: 2020, yearLte: null, sort: 'new' })).toBe(
			'sort=new&genres=Fantasy%2CHorror&yearGte=2020'
		);
	});
});
