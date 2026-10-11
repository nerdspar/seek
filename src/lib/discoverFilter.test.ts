import { describe, it, expect } from 'vitest';
import { emptyFilter, eraBounds, toggleEra, isActive, filterQuery, ERAS } from './discoverFilter';

describe('discover filter', () => {
	it('an empty filter is inactive and queries only type and sort', () => {
		const f = emptyFilter('tv');
		expect(isActive(f)).toBe(false);
		expect(filterQuery(f)).toBe('type=tv&sort=recommended');
	});

	it('facets build a combined query and mark it active', () => {
		const f = { ...emptyFilter('movie'), genres: [18], keywords: [{ id: 9715, name: 'heist' }], people: [{ id: 1, name: 'X' }], providers: [8], eras: ['2010s'], sort: 'top' as const };
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

	it('toggles eras in and out', () => {
		expect(toggleEra([], '2010s')).toEqual(['2010s']);
		expect(toggleEra(['2010s', '90s'], '2010s')).toEqual(['90s']);
	});

	it('spans multiple decades to a bounding window', () => {
		expect(eraBounds([])).toEqual({ gte: null, lte: null });
		expect(eraBounds(['2010s'])).toEqual({ gte: 2010, lte: 2019 });
		// Adjacent decades are exact; the span runs earliest to latest.
		expect(eraBounds(['2010s', '90s'])).toEqual({ gte: 1990, lte: 2019 });
		// Open-ended chips open that end.
		expect(eraBounds(['2020s'])).toEqual({ gte: 2020, lte: null });
		expect(eraBounds(['older'])).toEqual({ gte: null, lte: 1989 });
		expect(eraBounds(['2020s', 'older'])).toEqual({ gte: null, lte: null });
		expect(ERAS.length).toBe(5);
	});
});
