import { describe, it, expect } from 'vitest';
import { booksView } from './booksBrowse';

describe('booksView', () => {
	it('searches when there is a query, even with a genre picked', () => {
		expect(booksView('dune', null)).toBe('search');
		expect(booksView('dune', 'Fantasy')).toBe('search');
		expect(booksView('  spaced  ', 'Fantasy')).toBe('search');
	});

	it('shows the genre shelves when a genre is picked and the box is empty', () => {
		expect(booksView('', 'Fantasy')).toBe('genre');
		expect(booksView('   ', 'Fantasy')).toBe('genre');
	});

	it('shows home when nothing is typed and no genre is picked', () => {
		expect(booksView('', null)).toBe('home');
		expect(booksView('   ', null)).toBe('home');
	});
});
