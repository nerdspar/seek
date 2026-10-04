import { describe, it, expect, vi, beforeEach } from 'vitest';

const setShared = vi.fn();
const syncJointTags = vi.fn(async (..._a: unknown[]) => {});
vi.mock('$lib/server/household/run', () => ({
	setShared: (...a: unknown[]) => setShared(...a),
	syncJointTags: (...a: unknown[]) => syncJointTags(...a)
}));
vi.mock('$lib/server/household/shared', () => ({ listShared: () => [] }));
vi.mock('$lib/server/household/mirror', () => ({ mirrorMembers: () => [] }));
vi.mock('$lib/server/users', () => ({ listMembers: () => [] }));

import { DELETE } from './+server';

const me = { id: 1, householdId: 7 };
const del = (body: unknown) =>
	DELETE({ locals: { user: me }, request: new Request('http://x', { method: 'DELETE', body: JSON.stringify(body) }) } as never);

beforeEach(() => vi.clearAllMocks());

describe('DELETE /api/household/shared (Stop sharing)', () => {
	it('stops sharing a film as a film, and a show as a show', async () => {
		await del({ source: 'tmdb', mediaId: '1204680', mediaType: 'movie' });
		expect(setShared).toHaveBeenLastCalledWith(7, 1, { source: 'tmdb', mediaId: '1204680', mediaType: 'movie' }, false);
		await del({ source: 'tmdb', mediaId: '1204680' });
		expect(setShared).toHaveBeenLastCalledWith(7, 1, { source: 'tmdb', mediaId: '1204680', mediaType: 'tv' }, false);
		expect(syncJointTags).toHaveBeenCalledTimes(2);
	});

	it('needs a source and id', async () => {
		await expect(del({ mediaId: '1' })).rejects.toMatchObject({ status: 400 });
	});
});
