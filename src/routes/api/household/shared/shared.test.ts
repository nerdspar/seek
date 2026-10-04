import { describe, it, expect, vi, beforeEach } from 'vitest';

const shareMany = vi.fn();
let available = true;
let progress: unknown = null;
vi.mock('$lib/server/household/run', () => ({
	mirroringAvailable: () => available,
	bulkProgress: () => progress,
	shareMany: (...a: unknown[]) => shareMany(...a),
	setShared: vi.fn(),
	syncJointTags: vi.fn()
}));

import { POST } from './+server';

const me = { id: 1, householdId: 7 };
const post = (body: unknown) =>
	POST({ locals: { user: me }, request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) } as never);
const status = (p: unknown) => Promise.resolve(p as Response).then((r) => r.status, (e: { status: number }) => e.status);

beforeEach(() => {
	available = true;
	progress = null;
	shareMany.mockReset().mockReturnValue({ total: 2, done: 0, running: true });
});

describe('POST /api/household/shared (bulk)', () => {
	it('starts the import for a clean list', async () => {
		const res = await post({ shows: [{ source: 'tmdb', mediaId: '1', title: 'One' }, { source: 'tmdb', mediaId: '2' }] });
		expect(res.status).toBe(200);
		expect(shareMany).toHaveBeenCalledWith(7, 1, [
			{ source: 'tmdb', mediaId: '1', mediaType: 'tv', title: 'One' },
			{ source: 'tmdb', mediaId: '2', mediaType: 'tv', title: null }
		]);
	});

	it('carries films as films', async () => {
		await post({ shows: [{ source: 'tmdb', mediaId: '603', mediaType: 'movie', title: 'The Matrix' }] });
		expect(shareMany).toHaveBeenCalledWith(7, 1, [{ source: 'tmdb', mediaId: '603', mediaType: 'movie', title: 'The Matrix' }]);
	});

	it('refuses before both of you are linked, a malformed list, or a second run', async () => {
		available = false;
		expect(await status(post({ shows: [{ source: 'tmdb', mediaId: '1' }] }))).toBe(409);
		available = true;
		expect(await status(post({ shows: [{ source: 'tmdb' }] }))).toBe(400);
		expect(await status(post({ shows: [] }))).toBe(400);
		progress = { running: true };
		expect(await status(post({ shows: [{ source: 'tmdb', mediaId: '1' }] }))).toBe(409);
		expect(shareMany).not.toHaveBeenCalled();
	});
});
