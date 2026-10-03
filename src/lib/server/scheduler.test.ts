import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, useDatabase } from './db';
import * as users from './users';
import { currentUser, NotLinkedError } from './userctx';
import { forEachUser } from './scheduler';

let owner: users.User;
let member: users.User;

beforeEach(async () => {
	useDatabase(openDatabase(':memory:'));
	owner = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
	const { token } = users.createInvite(owner, 'm@x.co');
	member = await users.acceptInvite(token, { name: 'M', password: 'password-2' });
});
afterEach(() => {
	useDatabase(null);
	vi.restoreAllMocks();
});

describe('forEachUser', () => {
	it('runs the job once per account, as that account', async () => {
		const seen: number[] = [];
		await forEachUser(async () => {
			seen.push(currentUser()!.id);
		});
		expect(seen).toEqual([owner.id, member.id]);
	});

	it("skips someone who hasn't linked a service quietly, and carries on past failures", async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const ran: number[] = [];
		await forEachUser(async (u) => {
			ran.push(u.id);
			if (u.id === owner.id) throw new NotLinkedError('calendar');
			throw new Error('boom');
		});
		expect(ran).toEqual([owner.id, member.id]);
		// Only the real failure is logged.
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it('does nothing before anyone has signed up', async () => {
		useDatabase(openDatabase(':memory:'));
		const job = vi.fn();
		await forEachUser(job);
		expect(job).not.toHaveBeenCalled();
	});
});
