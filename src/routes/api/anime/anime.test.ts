import { describe, it, expect, vi, beforeEach } from 'vitest';

const setAnimeOverride = vi.fn();
const classifyShow = vi.fn(async (..._a: unknown[]) => true);
vi.mock('$lib/server/anime-sync', () => ({
	setAnimeOverride: (...a: unknown[]) => setAnimeOverride(...a),
	classifyShow: (...a: unknown[]) => classifyShow(...a)
}));
vi.mock('$lib/server/household/mirror', () => ({ mirrorMembers: () => [{ id: 1 }, { id: 2 }] }));
const ranAs: number[] = [];
vi.mock('$lib/server/userctx', () => ({ runAs: (u: { id: number }, fn: () => unknown) => (ranAs.push(u.id), fn()) }));

import { PUT } from './+server';

const put = (body: unknown) =>
	PUT({ locals: { user: { id: 1, householdId: 5 } }, request: new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }) } as never);

beforeEach(() => {
	vi.clearAllMocks();
	ranAs.length = 0;
});

describe('PUT /api/anime', () => {
	it("records the household's answer and re-files the show for everyone", async () => {
		const res = await put({ mediaId: '42', anime: true });
		expect(await res.json()).toEqual({ anime: true });
		expect(setAnimeOverride).toHaveBeenCalledWith(5, 1, '42', true);
		expect(classifyShow).toHaveBeenCalledTimes(2); // you, then the other member
		expect(ranAs).toEqual([2]);
	});

	it('refuses a request without a show or an answer', async () => {
		await expect(put({ mediaId: '42' })).rejects.toMatchObject({ status: 400 });
		expect(setAnimeOverride).not.toHaveBeenCalled();
	});
});
