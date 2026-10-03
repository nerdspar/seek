import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase } from './db';
import * as users from './users';
import {
	runAs,
	currentUser,
	floppyToken,
	calendarToken,
	bookorbitLogin,
	scopeKey,
	unscoped,
	refreshCredentials,
	NotLinkedError
} from './userctx';
import { memo, put, invalidate, invalidateEveryone, patch } from './memo';

let owner: users.User;
let member: users.User;

beforeEach(async () => {
	useDatabase(openDatabase(':memory:'));
	process.env.SEEK_TOKEN_KEY = 'k';
	process.env.FLOPPY_TOKEN = 'env-owner-token';
	process.env.FLOPPY_CALENDAR_TOKEN = 'env-cal';
	process.env.BOOKORBIT_USER = 'env-bo';
	process.env.BOOKORBIT_PASSWORD = 'env-bo-pw';
	owner = await users.createOwner({ email: 'o@x.co', name: 'Owner', password: 'password-1' });
	const { token } = users.createInvite(owner, 'm@x.co');
	member = await users.acceptInvite(token, { name: 'Member', password: 'password-2' });
});
afterEach(() => {
	useDatabase(null);
	for (const k of ['SEEK_TOKEN_KEY', 'FLOPPY_TOKEN', 'FLOPPY_CALENDAR_TOKEN', 'BOOKORBIT_USER', 'BOOKORBIT_PASSWORD']) {
		delete process.env[k];
	}
});

describe('credential resolution', () => {
	it('outside any user context, uses the env config (pre-accounts behaviour)', () => {
		expect(currentUser()).toBeNull();
		expect(floppyToken()).toBe('env-owner-token');
		expect(calendarToken()).toBe('env-cal');
		expect(bookorbitLogin()).toEqual({ username: 'env-bo', password: 'env-bo-pw', libraryId: null });
	});

	it('the owner falls back to env until they link their own', () => {
		runAs(owner, () => {
			expect(currentUser()?.id).toBe(owner.id);
			expect(floppyToken()).toBe('env-owner-token');
			users.setFloppyToken(owner.id, 'flp_owner_own');
			refreshCredentials();
			expect(floppyToken()).toBe('flp_owner_own');
		});
	});

	it('a member NEVER falls back to the owner’s env credentials', () => {
		runAs(member, () => {
			expect(() => floppyToken()).toThrow(NotLinkedError);
			expect(calendarToken()).toBeNull();
			expect(bookorbitLogin()).toBeNull();
		});
	});

	it('a member uses their own linked credentials', () => {
		users.setFloppyToken(member.id, 'flp_member');
		users.setBookOrbit(member.id, { username: 'wife', password: 'pw', libraryId: 3 });
		runAs(member, () => {
			expect(floppyToken()).toBe('flp_member');
			expect(bookorbitLogin()).toEqual({ username: 'wife', password: 'pw', libraryId: 3 });
		});
	});

	it('the not-linked error tells the person what to do', () => {
		runAs(member, () => {
			expect(() => floppyToken()).toThrow(/Settings → Your accounts/);
		});
	});
});

describe('cache isolation between users', () => {
	it('namespaces keys per user', () => {
		expect(scopeKey('watchlist:tv')).toBe('u0:watchlist:tv');
		runAs(owner, () => expect(scopeKey('watchlist:tv')).toBe(`u${owner.id}:watchlist:tv`));
		expect(unscoped(`u${owner.id}:watchlist:tv`)).toBe('watchlist:tv');
	});

	it('one person’s cached value is never served to the other', async () => {
		const ownerList = await runAs(owner, () => memo('isotest:tv', 60_000, async () => ['owner show']));
		const memberList = await runAs(member, () => memo('isotest:tv', 60_000, async () => ['member show']));
		expect(ownerList).toEqual(['owner show']);
		expect(memberList).toEqual(['member show']);
		// And the cached copies stay separate on re-read.
		expect(await runAs(owner, () => memo('isotest:tv', 60_000, async () => ['reloaded']))).toEqual(['owner show']);
	});

	it('a write in one account only touches that account’s cache', async () => {
		await runAs(owner, () => put('show:tmdb:1', 'owner'));
		await runAs(member, () => put('show:tmdb:1', 'member'));
		runAs(owner, () => invalidate('show:'));
		expect(await runAs(member, () => memo('show:tmdb:1', 60_000, async () => 'refetched'))).toBe('member');
		expect(await runAs(owner, () => memo('show:tmdb:1', 60_000, async () => 'refetched'))).toBe('refetched');
	});

	// The memo store is module-level and user ids repeat across these fresh
	// databases, so each test uses its own key prefix.
	it('patch callbacks see the unscoped key', async () => {
		await runAs(owner, () => put('patchtest:tv:a', 1));
		const seen: string[] = [];
		runAs(owner, () =>
			patch<number>('patchtest:', (v, key) => {
				seen.push(key);
				return v + 1;
			})
		);
		expect(seen).toEqual(['patchtest:tv:a']);
	});

	it('invalidateEveryone drops the key for all users', async () => {
		await runAs(owner, () => put('show:tmdb:2', 'o'));
		await runAs(member, () => put('show:tmdb:2', 'm'));
		invalidateEveryone('show:tmdb:2');
		expect(await runAs(owner, () => memo('show:tmdb:2', 60_000, async () => 'fresh'))).toBe('fresh');
		expect(await runAs(member, () => memo('show:tmdb:2', 60_000, async () => 'fresh'))).toBe('fresh');
	});
});
