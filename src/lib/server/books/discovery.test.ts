import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BookCard, ReadingBook } from '$lib/books';

const searchBooks = vi.fn();
vi.mock('./hardcover', () => ({ searchBooks: (...a: unknown[]) => searchBooks(...a) }));
vi.mock('./bookorbit', () => ({ bookorbitLinked: () => true, getAllBooks: async () => [] }));
vi.mock('./wishlist', () => ({ wishlistIds: () => new Set() }));

import { markOwned, indexLibrary, matchHardcover } from './discovery';

const card = (id: number, title = `B${id}`, author: string | null = null): BookCard => ({
	hardcoverId: id,
	title,
	author,
	coverUrl: null,
	year: null,
	rating: null
});
const mine = (over: Partial<ReadingBook>) =>
	({ id: 41, title: 'x', authors: [], status: 'reading', progress: 0.3, hardcoverId: null, ...over }) as ReadingBook;

beforeEach(() => searchBooks.mockReset());

describe('markOwned', () => {
	it('matches by Hardcover id when BookOrbit has one', () => {
		const out = markOwned([card(1), card(2)], indexLibrary([mine({ hardcoverId: 2 })]));
		expect(out[0].owned).toBeNull();
		expect(out[1].owned).toEqual({ bookId: 41, status: 'reading', progress: 0.3 });
	});

	it('falls back to title + author until BookOrbit has matched the book', () => {
		const lib = indexLibrary([mine({ title: "14th Deadly Sin: (Women's Murder Club 14)", authors: ['James Patterson'] })]);
		const [a, b] = markOwned(
			[card(9, '14th Deadly Sin', 'James Patterson'), card(10, '14th Deadly Sin', 'Someone Else')],
			lib
		);
		expect(a.owned?.bookId).toBe(41);
		expect(b.owned).toBeNull();
	});
});

describe('markOwned wishlist', () => {
	it('flags wished books, but owning one supersedes the wish', () => {
		const idx = indexLibrary([mine({ hardcoverId: 2 })], new Set([1, 2]));
		const [a, b, c] = markOwned([card(1), card(2), card(3)], idx);
		expect([a.wished, b.wished, c.wished]).toEqual([true, false, false]);
		expect(b.owned?.bookId).toBe(41);
	});
});

describe('matchHardcover', () => {
	it('takes only an exact title + author match', async () => {
		searchBooks.mockResolvedValue([
			card(1, 'Dune Messiah', 'Frank Herbert'),
			card(2, 'Dune: Deluxe Edition', 'Frank Herbert')
		]);
		expect(await matchHardcover('Dune', 'Frank Herbert')).toBe(2);
		expect(searchBooks).toHaveBeenCalledWith('Dune Frank Herbert', 5);
	});

	it('returns null rather than guess', async () => {
		searchBooks.mockResolvedValue([card(1, 'Dune Messiah', 'Frank Herbert')]);
		expect(await matchHardcover('Dune', 'Frank Herbert')).toBeNull();
	});
});
