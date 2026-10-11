import { describe, it, expect } from 'vitest';
import { booksView } from './booksBrowse';

describe('booksView', () => {
	it('searches when there is a query, even with a filter set', () => {
		expect(booksView('dune', false)).toBe('search');
		expect(booksView('dune', true)).toBe('search');
		expect(booksView('  spaced  ', true)).toBe('search');
	});

	it('browses the filter when one is active and the box is empty', () => {
		expect(booksView('', true)).toBe('filter');
		expect(booksView('   ', true)).toBe('filter');
	});

	it('shows home when nothing is typed and no filter is set', () => {
		expect(booksView('', false)).toBe('home');
		expect(booksView('   ', false)).toBe('home');
	});
});
