import { describe, it, expect, vi, beforeEach } from 'vitest';

const saveGoal = vi.fn(async (..._a: unknown[]) => 9);
const listGoals = vi.fn(async () => [{ id: 9 }]);
const deleteGoal = vi.fn(async (..._a: unknown[]) => {});
vi.mock('$lib/server/books/shelf', () => ({
	saveGoal: (...a: unknown[]) => saveGoal(...a),
	listGoals: () => listGoals(),
	deleteGoal: (...a: unknown[]) => deleteGoal(...a)
}));
vi.mock('$lib/server/books/hardcover', () => ({ HardcoverError: class extends Error {} }));

import { DELETE, PUT } from './+server';

const req = (method: string, body: unknown) => ({ request: new Request('http://x', { method, body: JSON.stringify(body) }) }) as never;
const good = { title: '2026 Reading Goal', metric: 'book', format: 'any', target: 12, startDate: '2026-01-01', endDate: '2026-12-31' };
const status = (p: unknown) => Promise.resolve(p as Response).then((r) => r.status, (e: { status: number }) => e.status);

beforeEach(() => vi.clearAllMocks());

describe('/api/books/goals', () => {
	it('saves a goal (new without an id, a change with one) and returns the fresh list', async () => {
		const res = await PUT(req('PUT', good));
		expect(await res.json()).toEqual({ id: 9, goals: [{ id: 9 }] });
		expect(saveGoal).toHaveBeenCalledWith({ ...good, id: null });
		await PUT(req('PUT', { ...good, id: 5, target: 12.6 }));
		expect(saveGoal).toHaveBeenLastCalledWith({ ...good, id: 5, target: 13 });
	});

	it('refuses a goal that makes no sense, before touching Hardcover', async () => {
		for (const bad of [
			{ ...good, metric: 'chapter' },
			{ ...good, format: 'skim' },
			{ ...good, target: 0 },
			{ ...good, startDate: '2026' },
			{ ...good, endDate: '2025-12-31' }
		]) {
			expect(await status(PUT(req('PUT', bad)))).toBe(400);
		}
		expect(saveGoal).not.toHaveBeenCalled();
	});

	it('deletes by id', async () => {
		await DELETE(req('DELETE', { id: 5 }));
		expect(deleteGoal).toHaveBeenCalledWith(5);
		expect(await status(DELETE(req('DELETE', {})))).toBe(400);
	});
});
