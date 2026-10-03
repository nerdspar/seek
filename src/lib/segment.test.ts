import { describe, it, expect } from 'vitest';
import { tabHref } from './segment';

describe('tabHref', () => {
	it('opens Watchlist and Discover on the segment you were last on', () => {
		expect(tabHref('watchlist', 'book')).toBe('/books');
		expect(tabHref('discover', 'book')).toBe('/discover/books');
		expect(tabHref('watchlist', 'movie')).toBe('/?type=movie');
		expect(tabHref('discover', 'tv')).toBe('/discover?type=tv');
		expect(tabHref('watchlist', null)).toBe('/');
	});
});
