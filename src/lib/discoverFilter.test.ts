import { describe, it, expect } from 'vitest';
import { emptyFilter, eraId, isActive, filterQuery, ERAS } from './discoverFilter';

describe('discover filter', () => {
	it('an empty filter is inactive and queries only type and sort', () => {
		const f = emptyFilter('tv');
		expect(isActive(f)).toBe(false);
		expect(filterQuery(f)).toBe('type=tv&sort=recommended');
	});

	it('facets build a combined query and mark it active', () => {
		const f = { ...emptyFilter('movie'), genres: [18], keywords: [{ id: 9715, name: 'heist' }], people: [{ id: 1, name: 'X' }], providers: [8], yearGte: 2010, yearLte: 2019, sort: 'top' as const };
		expect(isActive(f)).toBe(true);
		const q = new URLSearchParams(filterQuery(f));
		expect(q.get('type')).toBe('movie');
		expect(q.get('genres')).toBe('18');
		expect(q.get('keywords')).toBe('9715');
		expect(q.get('people')).toBe('1');
		expect(q.get('providers')).toBe('8');
		expect(q.get('yearGte')).toBe('2010');
		expect(q.get('yearLte')).toBe('2019');
		expect(q.get('sort')).toBe('top');
	});

	it('maps a decade window back to its chip', () => {
		expect(eraId({ ...emptyFilter('tv'), yearGte: 2010, yearLte: 2019 })).toBe('2010s');
		expect(eraId({ ...emptyFilter('tv'), yearGte: null, lte: 1989 } as never)).toBe(null);
		expect(eraId({ ...emptyFilter('tv'), yearGte: null, yearLte: 1989 })).toBe('older');
		expect(ERAS.length).toBe(5);
	});
});
