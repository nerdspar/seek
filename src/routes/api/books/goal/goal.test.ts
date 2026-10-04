import { describe, it, expect, vi, beforeEach } from 'vitest';

const setGoal = vi.fn(async (..._a: unknown[]) => {});
const readingGoal = vi.fn(async () => ({ goalBooks: 30, completedBooks: 12, year: 2026 }));
vi.mock('$lib/server/books/shelf', () => ({
	setGoal: (...a: unknown[]) => setGoal(...a),
	readingGoal: () => readingGoal()
}));
vi.mock('$lib/server/books/hardcover', () => ({ HardcoverError: class extends Error {} }));

import { PUT } from './+server';

const put = (body: unknown) => PUT({ request: new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }) } as never);

beforeEach(() => vi.clearAllMocks());

describe('PUT /api/books/goal', () => {
	it("sets this year's goal on Hardcover and returns it as the page shows it", async () => {
		const res = await put({ books: 30 });
		expect(setGoal).toHaveBeenCalledWith(30);
		expect(await res.json()).toEqual({ goal: { goalBooks: 30, completedBooks: 12, year: 2026 } });
	});

	it('wants a sensible number of books', async () => {
		await expect(put({ books: 0 })).rejects.toMatchObject({ status: 400 });
		expect(setGoal).not.toHaveBeenCalled();
	});
});
