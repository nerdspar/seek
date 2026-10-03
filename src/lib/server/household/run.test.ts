import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const reconcileHousehold = vi.fn();
const backfillShow = vi.fn();
let linked: { id: number }[] = [];
vi.mock('./mirror', () => ({
	reconcileHousehold: (...a: unknown[]) => reconcileHousehold(...a),
	backfillShow: (...a: unknown[]) => backfillShow(...a),
	mirrorMembers: () => linked
}));
const setJoint = vi.fn(async (..._args: unknown[]) => []);
vi.mock('../tags', () => ({ setJoint: (...a: unknown[]) => setJoint(...a) }));

import { openDatabase, useDatabase } from '../db';
import * as users from '../users';
import { runAs } from '../userctx';
import { isShared, share } from './shared';
import { afterMark, reconcileSoon, setShared, syncJointTags } from './run';

let owner: users.User;
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
	useDatabase(openDatabase(':memory:'));
	owner = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
	linked = [{ id: owner.id }, { id: 999 }];
	reconcileHousehold.mockReset().mockResolvedValue({ mirrored: 0, already: 0, failed: 0 });
	backfillShow.mockReset().mockResolvedValue({ mirrored: 0, already: 0, failed: 0 });
	setJoint.mockClear();
});
afterEach(() => {
	vi.useRealTimers();
	useDatabase(null);
});

const show = { source: 'tmdb', mediaId: '95350', title: 'Lanterns' };

describe('setShared', () => {
	it('backfills only the first time a show is shared', async () => {
		expect(setShared(owner.householdId, owner.id, show, true)).toBe(true);
		expect(setShared(owner.householdId, owner.id, show, true)).toBe(true);
		await flush();
		expect(backfillShow).toHaveBeenCalledTimes(1);
		expect(backfillShow).toHaveBeenCalledWith(owner.householdId, 'tmdb', '95350');
		expect(isShared(owner.householdId, 'tmdb', '95350')).toBe(true);
	});

	it('unsharing just removes it', () => {
		share(owner.householdId, owner.id, show);
		expect(setShared(owner.householdId, owner.id, show, false)).toBe(false);
		expect(isShared(owner.householdId, 'tmdb', '95350')).toBe(false);
		expect(backfillShow).not.toHaveBeenCalled();
	});

	it('never runs two passes at once for a household', async () => {
		let release!: () => void;
		backfillShow.mockImplementationOnce(() => new Promise((r) => (release = () => r({ mirrored: 0, already: 0, failed: 0 }))));
		setShared(owner.householdId, owner.id, show, true);
		setShared(owner.householdId, owner.id, { ...show, mediaId: '1' }, true);
		await flush();
		expect(backfillShow).toHaveBeenCalledTimes(1);
		release();
		await flush();
		await flush();
		expect(backfillShow).toHaveBeenCalledTimes(2);
	});
});

describe('afterMark', () => {
	it('nudges one debounced pass for a shared show, nothing for others', async () => {
		vi.useFakeTimers();
		share(owner.householdId, owner.id, show);
		runAs(owner, () => {
			afterMark('tmdb', '95350');
			afterMark('tmdb', '95350');
			afterMark('tmdb', 'not-shared');
		});
		await vi.advanceTimersByTimeAsync(5000);
		expect(reconcileHousehold).toHaveBeenCalledTimes(1);
	});

	it('does nothing until two people have Floppy linked', async () => {
		vi.useFakeTimers();
		linked = [{ id: owner.id }];
		share(owner.householdId, owner.id, show);
		runAs(owner, () => afterMark('tmdb', '95350'));
		await vi.advanceTimersByTimeAsync(5000);
		expect(reconcileHousehold).not.toHaveBeenCalled();
	});

	it('a failing pass is logged, not thrown', async () => {
		vi.useFakeTimers();
		reconcileHousehold.mockRejectedValueOnce(new Error('Floppy down'));
		reconcileSoon(owner.householdId, 10);
		await vi.advanceTimersByTimeAsync(20);
		expect(reconcileHousehold).toHaveBeenCalledTimes(1);
	});
});

describe('syncJointTags', () => {
	it("sets everyone's tag except the person who already set theirs", async () => {
		const wife = { ...owner, id: 999, role: 'member' as const };
		linked = [owner, wife];
		await syncJointTags(owner.householdId, show, true, owner.id);
		expect(setJoint).toHaveBeenCalledTimes(1);
		expect(setJoint).toHaveBeenCalledWith('tv', 'tmdb', '95350', true);
	});
});
