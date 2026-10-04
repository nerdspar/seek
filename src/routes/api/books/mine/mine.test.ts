import { describe, it, expect, vi, beforeEach } from 'vitest';

const setStatus = vi.fn(async (..._a: unknown[]) => {});
const setRating = vi.fn(async (..._a: unknown[]) => {});
const setPages = vi.fn(async (..._a: unknown[]) => {});
vi.mock('$lib/server/books/shelf', () => ({
	setStatus: (...a: unknown[]) => setStatus(...a),
	setRating: (...a: unknown[]) => setRating(...a),
	setPages: (...a: unknown[]) => setPages(...a)
}));
const { HardcoverError } = vi.hoisted(() => ({ HardcoverError: class extends Error {} }));
vi.mock('$lib/server/books/hardcover', () => ({ HardcoverError }));
vi.mock('$lib/server/memo', () => ({ invalidate: vi.fn() }));

import { PUT } from './+server';

const put = (body: unknown) => PUT({ request: new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }) } as never);
const status = (p: unknown) => Promise.resolve(p as Response).then((r) => r.status, (e: { status: number }) => e.status);

beforeEach(() => vi.clearAllMocks());

describe('PUT /api/books/mine', () => {
	it('changes one thing: status (null takes it off), rating, or pages', async () => {
		await put({ hardcoverId: 7, status: 'reading' });
		await put({ hardcoverId: 7, status: null });
		await put({ hardcoverId: 7, rating: 4 });
		await put({ hardcoverId: 7, pages: 120 });
		expect(setStatus.mock.calls).toEqual([
			[7, 'reading'],
			[7, null]
		]);
		expect(setRating).toHaveBeenCalledWith(7, 4);
		expect(setPages).toHaveBeenCalledWith(7, 120);
	});

	it('refuses nonsense before touching Hardcover', async () => {
		expect(await status(put({ hardcoverId: 0, status: 'read' }))).toBe(400);
		expect(await status(put({ hardcoverId: 7, status: 'skimmed' }))).toBe(400);
		expect(await status(put({ hardcoverId: 7, rating: 6 }))).toBe(400);
		expect(await status(put({ hardcoverId: 7, pages: -1 }))).toBe(400);
		expect(await status(put({ hardcoverId: 7 }))).toBe(400);
		expect(setStatus).not.toHaveBeenCalled();
	});

	it("says when Hardcover refused, and that nothing changed", async () => {
		setStatus.mockRejectedValueOnce(new HardcoverError('Hardcover: Book not found'));
		await expect(put({ hardcoverId: 7, status: 'read' })).rejects.toMatchObject({ status: 502, body: { message: 'Hardcover: Book not found — nothing changed.' } });
	});
});
