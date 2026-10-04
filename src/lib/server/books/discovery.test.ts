import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapReadingBook, myBooks, type BookCard, type ReadingBook, type ShelfBook } from '$lib/books';

const searchBooks = vi.fn();
const authorBooks = vi.fn();
const seriesAfter = vi.fn();
const genreBooks = vi.fn();
const bookDetail = vi.fn();
vi.mock('./hardcover', () => ({
	searchBooks: (...a: unknown[]) => searchBooks(...a),
	authorBooks: (...a: unknown[]) => authorBooks(...a),
	seriesAfter: (...a: unknown[]) => seriesAfter(...a),
	genreBooks: (...a: unknown[]) => genreBooks(...a),
	bookDetail: (...a: unknown[]) => bookDetail(...a)
}));
let library: ReadingBook[] = [];
vi.mock('./bookorbit', () => ({ bookorbitLinked: () => true, getAllBooks: async () => library }));
let shelf: ShelfBook[] = [];
let linked = true;
vi.mock('./shelf', () => ({ shelfLinked: () => linked, myShelf: async () => shelf }));

import { indexBooks, markOwned, matchHardcover, myBookList, personalRails } from './discovery';
import { invalidateEveryone } from '../memo';

const card = (id: number, title = `B${id}`, author: string | null = null): BookCard => ({
	hardcoverId: id,
	title,
	author,
	coverUrl: null,
	year: null,
	rating: null
});
const lib = (id: number, title: string, author: string, hardcoverId: number | null = null, extra: Record<string, unknown> = {}) =>
	({ ...mapReadingBook({ id, title, authors: [author], ...extra }), hardcoverId }) as ReadingBook;
const sb = (hardcoverId: number, title: string, author: string, over: Partial<ShelfBook> = {}): ShelfBook => ({
	userBookId: hardcoverId + 1000,
	hardcoverId,
	title,
	authors: [author],
	coverUrl: null,
	year: null,
	pages: null,
	genres: [],
	status: 'want_to_read',
	rating: null,
	readId: null,
	startedAt: null,
	finishedAt: null,
	progressPages: null,
	addedAt: null,
	updatedAt: null,
	...over
});

beforeEach(() => {
	searchBooks.mockReset();
	library = [];
	shelf = [];
	linked = true;
});

describe('markOwned', () => {
	it('a library book carries your shelf status; a shelf-only book is "mine"; anything else is neither', () => {
		const books = myBooks(
			[lib(41, 'Dune', 'Frank Herbert', 2, { pageCount: 600 })],
			[sb(2, 'Dune', 'Frank Herbert', { status: 'reading', rating: 4 }), sb(1, 'Paper', 'A', { status: 'read' })]
		);
		const [a, b, c] = markOwned([card(1), card(2), card(3)], indexBooks(books));
		expect([a.owned, a.mine]).toEqual([null, 'read']);
		expect(b.owned).toEqual({ bookId: 41, status: 'reading', progress: null, rating: 4, pages: 600 });
		expect(b.mine).toBeNull();
		expect([c.owned, c.mine]).toEqual([null, null]);
	});

	it('finds a library book BookOrbit has not matched yet by title + author', () => {
		const idx = indexBooks(myBooks([lib(41, "14th Deadly Sin: (Women's Murder Club 14)", 'James Patterson')], []));
		const [a, b] = markOwned([card(9, '14th Deadly Sin', 'James Patterson'), card(10, '14th Deadly Sin', 'Someone Else')], idx);
		expect(a.owned).toMatchObject({ bookId: 41, status: 'unread' });
		expect(b.owned).toBeNull();
	});
});

describe('myBookList', () => {
	it('is your Hardcover shelf joined to the library', async () => {
		library = [lib(1, 'Dune', 'Frank Herbert', 2)];
		shelf = [sb(2, 'Dune', 'Frank Herbert', { status: 'read' }), sb(5, 'Paper', 'A')];
		expect((await myBookList()).map((b) => [b.key, b.source, b.status])).toEqual([
			['hc:2', 'library', 'read'],
			['hc:5', 'entry', 'want_to_read']
		]);
	});

	it('without your own Hardcover token, is just the library, nothing started', async () => {
		linked = false;
		library = [lib(1, 'Dune', 'Frank Herbert', 2)];
		shelf = [sb(2, 'Dune', 'Frank Herbert', { status: 'read' })];
		expect((await myBookList()).map((b) => [b.key, b.status])).toEqual([['lib:1', 'unread']]);
	});
});

describe('matchHardcover', () => {
	it('takes only an exact title + author match', async () => {
		searchBooks.mockResolvedValue([card(1, 'Dune Messiah', 'Frank Herbert'), card(2, 'Dune: Deluxe Edition', 'Frank Herbert')]);
		expect(await matchHardcover('Dune', 'Frank Herbert')).toBe(2);
		expect(searchBooks).toHaveBeenCalledWith('Dune Frank Herbert', 5);
	});

	it('returns null rather than guess', async () => {
		searchBooks.mockResolvedValue([card(1, 'Dune Messiah', 'Frank Herbert')]);
		expect(await matchHardcover('Dune', 'Frank Herbert')).toBeNull();
	});
});

describe('personalRails', () => {
	beforeEach(() => {
		invalidateEveryone('books:personal');
		for (const m of [authorBooks, seriesAfter, genreBooks, bookDetail]) m.mockReset();
	});
	const c = (id: number, title = `B${id}`, author = 'Brandon Sanderson') => card(id, title, author);

	it('recommends the next in the series and more by the author, then your genre — never what you have', async () => {
		library = [
			lib(1, 'Mistborn', 'Brandon Sanderson', 100, { genres: ['Fantasy'] }),
			lib(2, 'The Well of Ascension', 'Brandon Sanderson', 101)
		];
		shelf = [sb(100, 'Mistborn', 'Brandon Sanderson', { status: 'read', rating: 5 })];
		seriesAfter.mockResolvedValue([c(101, 'The Well of Ascension'), c(102, 'The Hero of Ages')]);
		authorBooks.mockResolvedValue([c(100, 'Mistborn'), c(103), c(104), c(105)]);
		genreBooks.mockResolvedValue({ recent: [c(200, 'Fourth Wing', 'Rebecca Yarros'), c(201, 'X', 'Y'), c(202, 'Z', 'W')], popular: [c(103)] });

		const rails = await personalRails();
		expect(rails.map((r) => r.title)).toEqual(['Because you read Mistborn', 'Because you like Fantasy']);
		expect(rails[0].books.map((b) => b.hardcoverId)).toEqual([102, 103, 104, 105]);
		expect(rails[1].books.map((b) => b.hardcoverId)).toEqual([200, 201, 202]);
		expect(seriesAfter).toHaveBeenCalledWith(100);
	});

	it('is empty (not an error) when there is nothing to grow from yet', async () => {
		expect(await personalRails()).toEqual([]);
		expect(authorBooks).not.toHaveBeenCalled();
	});

	it('with nothing finished, grows from what was added to the library lately', async () => {
		library = [lib(1, 'Mistborn', 'Brandon Sanderson', 100, { genres: ['Fantasy'], addedAt: '2026-09-01' })];
		seriesAfter.mockResolvedValue([]);
		authorBooks.mockResolvedValue([c(103), c(104), c(105)]);
		genreBooks.mockResolvedValue({ recent: [c(200, 'A', 'X'), c(201, 'B', 'Y'), c(202, 'C', 'Z')], popular: [] });
		const rails = await personalRails();
		expect(rails.map((r) => r.title)).toEqual(['More like Mistborn', 'Because you like Fantasy']);
	});

	it('grows from books only on your shelf (a Goodreads import), and never recommends what is on it', async () => {
		shelf = [
			sb(300, 'Dune', 'Frank Herbert', { status: 'read', rating: 5 }),
			sb(301, 'Dune Messiah', 'Frank Herbert')
		];
		seriesAfter.mockResolvedValue([c(301, 'Dune Messiah', 'Frank Herbert'), c(302, 'Children of Dune', 'Frank Herbert')]);
		authorBooks.mockResolvedValue([c(303, 'X', 'Frank Herbert'), c(304, 'Y', 'Frank Herbert')]);
		bookDetail.mockResolvedValue(null);
		genreBooks.mockResolvedValue({ recent: [], popular: [] });
		const rails = await personalRails();
		expect(rails[0].title).toBe('Because you read Dune');
		expect(rails[0].books.map((b) => b.hardcoverId)).toEqual([302, 303, 304]);
	});
});
