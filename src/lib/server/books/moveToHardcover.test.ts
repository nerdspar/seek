import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapReadingBook, type ReadingBook } from '$lib/books';
import type { ImportedBook } from './shelf';

let library: ReadingBook[] = [];
vi.mock('./bookorbit', () => ({ bookorbitLinked: () => true, getAllBooks: async () => library }));
let linked = true;
const imported: ImportedBook[] = [];
let refuse: number | null = null;
vi.mock('./shelf', () => ({
	shelfLinked: () => linked,
	myShelf: async () => [],
	importBook: async (b: ImportedBook) => {
		if (b.hardcoverId === refuse) throw new Error('Hardcover said no');
		imported.push(b);
		return b.hardcoverId === 99 ? 'already' : 'added';
	}
}));

import { openDatabase, useDatabase, db } from '../db';
import * as users from '../users';
import { runAs } from '../userctx';
import { fromLibraryBook, moveToHardcover } from './moveToHardcover';

let me: users.User;
const entry = (hardcoverId: number, status: string, over: Record<string, unknown> = {}) =>
	db()
		.prepare(
			`INSERT INTO book_entries (user_id, hardcover_id, title, status, rating, progress_pages, started_at, finished_at, added_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'then', 'then')`
		)
		.run(me.id, hardcoverId, `Book ${hardcoverId}`, status, over.rating ?? null, over.pages ?? null, over.started ?? null, over.finished ?? null);
const libBook = (id: number, hardcoverId: number | null, status: string, extra: Record<string, unknown> = {}) =>
	({ ...mapReadingBook({ id, title: `L${id}`, readStatus: { status }, ...extra }), hardcoverId }) as ReadingBook;
const move = () => runAs(me, () => moveToHardcover(0));

beforeEach(async () => {
	process.env.SEEK_TOKEN_KEY = 'test-token-key';
	useDatabase(openDatabase(':memory:'));
	me = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
	library = [];
	linked = true;
	imported.length = 0;
	refuse = null;
});
afterEach(() => useDatabase(null));

describe('moveToHardcover', () => {
	it("moves Seek's own books and library books with a status or rating, once", async () => {
		entry(1, 'reading', { pages: 120, started: '2026-09-01T10:00:00Z' });
		entry(2, 'read', { rating: 5, finished: '2026-08-01T10:00:00Z' });
		library = [
			libBook(10, 20, 'read', { rating: 4, readStatus: { status: 'read', finishedAt: '2026-07-01T00:00:00Z' } }),
			libBook(11, 21, 'unread'), // nothing to bring
			libBook(12, null, 'read'), // no Hardcover id: can't
			libBook(13, 2, 'reading') // the same book as entry 2: Seek's record wins
		];
		expect(await move()).toEqual({ added: 3, already: 0, failed: 0 });
		expect(imported.map((b) => [b.hardcoverId, b.status, b.rating])).toEqual([
			[20, 'read', 4],
			[2, 'read', 5],
			[1, 'reading', null]
		]);
		expect(imported.find((b) => b.hardcoverId === 1)).toMatchObject({ progressPages: 120, startedAt: '2026-09-01T10:00:00Z' });
		expect(await move()).toEqual({ skipped: 'already moved' });
	});

	it('tries again next time if any book failed, keeping what went across', async () => {
		entry(1, 'read');
		entry(2, 'read');
		refuse = 2;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await move()).toEqual({ added: 1, already: 0, failed: 1 });
		refuse = null;
		expect(await move()).toMatchObject({ failed: 0 });
		warn.mockRestore();
	});

	it('waits until you link Hardcover', async () => {
		linked = false;
		entry(1, 'read');
		expect(await move()).toEqual({ skipped: 'no Hardcover token' });
		expect(imported).toEqual([]);
	});
});

describe('fromLibraryBook', () => {
	it("maps BookOrbit's statuses onto Hardcover's shelves", () => {
		expect(fromLibraryBook(libBook(1, 5, 'rereading'))?.status).toBe('reading');
		expect(fromLibraryBook(libBook(1, 5, 'skimmed'))?.status).toBe('read');
		expect(fromLibraryBook(libBook(1, 5, 'unread', { rating: 3 }))?.status).toBe('read'); // rated → read
		expect(fromLibraryBook(libBook(1, 5, 'unread'))).toBeNull();
		expect(fromLibraryBook(libBook(1, 5, 'reading', { readingProgress: 0.5, pageCount: 300 }))?.progressPages).toBe(150);
	});
});
