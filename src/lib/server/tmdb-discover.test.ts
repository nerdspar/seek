import { describe, it, expect } from 'vitest';
import { discoverParams } from './tmdb';

describe('discoverParams', () => {
	it('builds people (cast, AND), genres (AND), keywords (OR) and a decade window', () => {
		const p = discoverParams({ mediaType: 'movie', genres: [18], keywords: [9715, 818], people: [1, 2], yearGte: 2010, yearLte: 2019, sort: 'top' });
		expect(p.with_cast).toBe('1,2');
		expect(p.with_genres).toBe('18');
		expect(p.with_keywords).toBe('9715|818');
		expect(p['primary_release_date.gte']).toBe('2010-01-01');
		expect(p['primary_release_date.lte']).toBe('2019-12-31');
		expect(p.sort_by).toBe('vote_average.desc');
	});

	it('uses the tv date field and a provider region', () => {
		const p = discoverParams({ mediaType: 'tv', providers: [8], yearGte: 2020 });
		expect(p['first_air_date.gte']).toBe('2020-01-01');
		expect(p.with_watch_providers).toBe('8');
		expect(p.watch_region).toBe('US');
		expect(p.sort_by).toBe('popularity.desc');
	});

	it('omits what is not set', () => {
		const p = discoverParams({ mediaType: 'tv' });
		expect(p.with_cast).toBeUndefined();
		expect(p.with_genres).toBeUndefined();
		expect(p['first_air_date.lte']).toBeUndefined();
	});
});
