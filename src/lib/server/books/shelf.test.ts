import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let myToken: string | null = 'hc_mine';
vi.mock('../userctx', async (orig) => ({ ...(await orig<object>()), hardcoverUserToken: () => myToken }));

import { getGoal, myShelf, setGoal, setPages, setRating, setStatus } from './shelf';
import { invalidateEveryone } from '../memo';

/* A fake Hardcover: a shelf of user_book rows, goals, and every mutation recorded. */
type Row = Record<string, unknown>;
let shelf: Row[] = [];
let goals: Row[] = [];
let calls: { op: string; vars: Record<string, unknown> }[] = [];
let failNext: string | null = null;

const ub = (id: number, bookId: number, status_id: number, read: Row | null = null, over: Row = {}): Row => ({
	id,
	status_id,
	rating: null,
	date_added: '2026-01-01',
	updated_at: '2026-01-01T00:00:00Z',
	book: { id: bookId, title: `Book ${bookId}`, pages: 300, cached_contributors: [], cached_tags: {} },
	user_book_reads: read ? [read] : [],
	...over
});

function fakeFetch(_url: string, init: { body: string; headers: Record<string, string> }) {
	const { query, variables = {} } = JSON.parse(init.body) as { query: string; variables?: Record<string, unknown> };
	const op = query.match(/\b(insert_user_book_read|update_user_book_read|insert_user_book|update_user_book|delete_user_book|insert_goal|update_goal)\b/)?.[1];
	const reply = (data: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) } as Response);
	if (op) {
		calls.push({ op, vars: variables });
		if (failNext === op) {
			failNext = null;
			return reply({ [op]: { id: null, error: 'Book not found' } });
		}
		if (op === 'insert_goal' || op === 'update_goal') return reply({ [op]: { id: 9, errors: null } });
		return reply({ [op]: { id: 4242, error: null } });
	}
	if (query.includes('goals')) return reply({ me: [{ goals }] });
	const offset = Number(variables.offset ?? 0);
	return reply({ me: [{ user_books: shelf.slice(offset, offset + 500) }] });
}

const ops = () => calls.map((c) => c.op);
const NOW = new Date('2026-10-04T15:00:00');

beforeEach(() => {
	myToken = 'hc_mine';
	shelf = [];
	goals = [];
	calls = [];
	failNext = null;
	invalidateEveryone('books:');
	vi.stubGlobal('fetch', vi.fn(fakeFetch));
});
afterEach(() => vi.unstubAllGlobals());

describe('myShelf', () => {
	it('reads every page of your shelf, as you', async () => {
		shelf = Array.from({ length: 501 }, (_, i) => ub(i + 1, 100 + i, 3));
		const books = await myShelf();
		expect(books).toHaveLength(501);
		expect(books[0]).toMatchObject({ userBookId: 1, hardcoverId: 100, status: 'read' });
		const auth = (vi.mocked(fetch).mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization;
		expect(auth).toBe('Bearer hc_mine');
	});

	it('says to link Hardcover when you have no token', async () => {
		myToken = null;
		await expect(myShelf()).rejects.toMatchObject({ name: 'NotLinkedError', service: 'hardcover' });
	});
});

describe('setStatus', () => {
	it('a new book you start reading: on the shelf as Reading, with a read started today', async () => {
		await setStatus(7, 'reading', NOW);
		expect(calls).toEqual([
			{ op: 'insert_user_book', vars: { o: { book_id: 7, status_id: 2 } } },
			{ op: 'insert_user_book_read', vars: { id: 4242, r: { started_at: '2026-10-04' } } }
		]);
	});

	it('finishing what you were reading closes that read today (pages filled in)', async () => {
		shelf = [ub(55, 7, 2, { id: 900, started_at: '2026-09-20', finished_at: null, progress_pages: 120 })];
		await setStatus(7, 'read', NOW);
		expect(calls).toEqual([
			{ op: 'update_user_book', vars: { id: 55, o: { status_id: 3 } } },
			{ op: 'update_user_book_read', vars: { id: 900, r: { started_at: '2026-09-20', finished_at: '2026-10-04', progress_pages: 300 } } }
		]);
	});

	it('marking a book Read that you never started records a read finished today', async () => {
		shelf = [ub(55, 7, 1)];
		await setStatus(7, 'read', NOW);
		expect(ops()).toEqual(['update_user_book', 'insert_user_book_read']);
		expect(calls[1].vars).toEqual({ id: 55, r: { finished_at: '2026-10-04' } });
	});

	it('wanting, pausing or giving up just moves the shelf; null takes it off', async () => {
		shelf = [ub(55, 7, 2, { id: 900, started_at: '2026-09-20', finished_at: null })];
		await setStatus(7, 'on_hold', NOW);
		expect(calls).toEqual([{ op: 'update_user_book', vars: { id: 55, o: { status_id: 4 } } }]);
		calls = [];
		await setStatus(7, null, NOW);
		expect(calls).toEqual([{ op: 'delete_user_book', vars: { id: 55 } }]);
	});

	it('re-reads the shelf after a write, even one Hardcover refused', async () => {
		await myShelf();
		failNext = 'insert_user_book';
		await expect(setStatus(8, 'want_to_read', NOW)).rejects.toThrow('Book not found');
		const reads = () => vi.mocked(fetch).mock.calls.filter((c) => !/mutation/.test(JSON.parse((c[1] as { body: string }).body).query)).length;
		const before = reads();
		await myShelf();
		expect(reads()).toBe(before + 1);
	});
});

describe('setRating and setPages', () => {
	it('rates a shelf book in place; rating one not on your shelf files it under Read', async () => {
		shelf = [ub(55, 7, 2)];
		await setRating(7, 4);
		await setRating(8, 5);
		expect(calls).toEqual([
			{ op: 'update_user_book', vars: { id: 55, o: { rating: 4 } } },
			{ op: 'insert_user_book', vars: { o: { book_id: 8, status_id: 3, rating: 5 } } }
		]);
	});

	it('the page you are on: updates the open read, or starts Reading with one', async () => {
		shelf = [ub(55, 7, 2, { id: 900, started_at: '2026-09-20', finished_at: null })];
		await setPages(7, 150, NOW);
		await setPages(8, 20, NOW);
		expect(calls).toEqual([
			{ op: 'update_user_book_read', vars: { id: 900, r: { started_at: '2026-09-20', progress_pages: 150 } } },
			{ op: 'insert_user_book', vars: { o: { book_id: 8, status_id: 2 } } },
			{ op: 'insert_user_book_read', vars: { id: 4242, r: { started_at: '2026-10-04', progress_pages: 20 } } }
		]);
	});
});

describe('the reading goal', () => {
	it("reads this year's book goal and Hardcover's count", async () => {
		goals = [
			{ id: 3, goal: 30, progress: 12, start_date: '2026-01-01', end_date: '2026-12-31' },
			{ id: 2, goal: 20, progress: 25, start_date: '2025-01-01', end_date: '2025-12-31' }
		];
		expect(await getGoal(NOW)).toEqual({ year: 2026, target: 30, done: 12 });
	});

	it('updates the goal you have, or creates one for the year', async () => {
		goals = [{ id: 3, goal: 30, progress: 12, start_date: '2026-01-01', end_date: '2026-12-31' }];
		await setGoal(40, NOW);
		expect(calls[0]).toEqual({
			op: 'update_goal',
			vars: { id: 3, o: { metric: 'book', goal: 40, start_date: '2026-01-01', end_date: '2026-12-31', description: '2026 Reading Goal' } }
		});
		goals = [];
		calls = [];
		await setGoal(25, NOW);
		expect(calls[0]).toMatchObject({ op: 'insert_goal', vars: { o: { goal: 25, start_date: '2026-01-01', end_date: '2026-12-31' } } });
		expect(await getGoal(NOW)).toBeNull();
	});
});
