import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, useDatabase, MIGRATIONS, db, migrate } from './db';
import * as users from './users';
import { AccountError } from './users';

beforeEach(() => {
	useDatabase(openDatabase(':memory:'));
	process.env.SEEK_TOKEN_KEY = 'test-token-key';
});
afterEach(() => {
	useDatabase(null);
	delete process.env.SEEK_TOKEN_KEY;
});

const owner = () =>
	users.createOwner({ email: 'Scott@Example.com', name: 'Scott', password: 'password-1' });

describe('migrations', () => {
	it('lands at the latest version and is idempotent', () => {
		expect(db().pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
		migrate(db());
		expect(db().pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
	});

	it('upgrades an existing v1 database without losing accounts', async () => {
		// A database as the first release left it: only v1 applied, one owner.
		const old = new Database(':memory:');
		old.pragma('foreign_keys = ON');
		old.exec(MIGRATIONS[0] as string);
		old.pragma('user_version = 1');
		useDatabase(old);
		await owner();

		migrate(old);
		expect(old.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
		expect(users.userCount()).toBe(1);
		// Retired in v11, once reading state had moved to Hardcover.
		expect(old.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='book_entries'`).get()).toBeFalsy();
	});

	it('v11 keeps a copy of any book records that never moved to Hardcover before dropping them', () => {
		const dir = mkdtempSync(join(tmpdir(), 'seek-v11-'));
		const file = new Database(join(dir, 'seek.db'));
		file.pragma('foreign_keys = ON');
		for (let v = 0; v < 10; v++) file.exec(MIGRATIONS[v] as string);
		file.pragma('user_version = 10');
		file.exec(`INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')`);
		file.exec(`INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x'), (2, 1, 'b@x', 'B', 'member', 'h', 'x')`);
		file.exec(`INSERT INTO books_moved (user_id, moved_at) VALUES (1, 'x')`);
		file.exec(`INSERT INTO book_entries (user_id, hardcover_id, title, status, added_at, updated_at) VALUES (1, 10, 'Moved', 'read', 'x', 'x'), (2, 20, 'Not moved', 'reading', 'x', 'x')`);

		migrate(file);
		const kept = JSON.parse(readFileSync(join(dir, 'book_entries-unmoved.json'), 'utf8'));
		expect(kept.map((r: { title: string }) => r.title)).toEqual(['Not moved']);
		expect(file.prepare(`SELECT name FROM sqlite_master WHERE name IN ('book_entries', 'books_moved')`).all()).toEqual([]);
		file.close();
		rmSync(dir, { recursive: true, force: true });
	});
});

describe('bootstrap owner', () => {
	it('creates the household and its owner, with a normalised email', async () => {
		const u = await owner();
		expect(u).toMatchObject({ email: 'scott@example.com', name: 'Scott', role: 'owner', sessionVersion: 1 });
		expect(users.userCount()).toBe(1);
		expect(users.householdName(u.householdId)).toBe('Home');
		expect(users.getOwner()?.id).toBe(u.id);
	});

	it('refuses a second bootstrap once anyone exists', async () => {
		await owner();
		await expect(
			users.createOwner({ email: 'x@example.com', name: 'X', password: 'password-1' })
		).rejects.toThrow(AccountError);
	});

	it('validates email, name and password length', async () => {
		await expect(users.createOwner({ email: 'nope', name: 'A', password: 'password-1' })).rejects.toThrow(/valid email/);
		await expect(users.createOwner({ email: 'a@b.co', name: '  ', password: 'password-1' })).rejects.toThrow(/name/);
		await expect(users.createOwner({ email: 'a@b.co', name: 'A', password: 'short' })).rejects.toThrow(/at least/);
	});
});

describe('authenticate', () => {
	it('accepts the right password (email case-insensitive) and rejects the rest', async () => {
		await owner();
		expect((await users.authenticate('SCOTT@example.com', 'password-1'))?.name).toBe('Scott');
		expect(await users.authenticate('scott@example.com', 'wrong-pass')).toBeNull();
		expect(await users.authenticate('nobody@example.com', 'password-1')).toBeNull();
	});
});

describe('passwords', () => {
	it('changing the password bumps the session version (signs out other devices)', async () => {
		const u = await owner();
		const after = await users.changePassword(u.id, 'password-1', 'password-2');
		expect(after.sessionVersion).toBe(2);
		expect(await users.authenticate(u.email, 'password-2')).not.toBeNull();
		expect(await users.authenticate(u.email, 'password-1')).toBeNull();
	});

	it('rejects a wrong current password', async () => {
		const u = await owner();
		await expect(users.changePassword(u.id, 'nope-nope', 'password-2')).rejects.toThrow(/incorrect/);
	});

	it('sign out everywhere bumps the version without changing the password', async () => {
		const u = await owner();
		users.signOutEverywhere(u.id);
		expect(users.getUser(u.id)?.sessionVersion).toBe(2);
	});
});

describe('invites', () => {
	it('lets the owner invite, and the invitee join as a verified member', async () => {
		const o = await owner();
		const { token, email } = users.createInvite(o, ' Wife@Example.com ');
		expect(email).toBe('wife@example.com');
		expect(users.peekInvite(token)).toEqual({ email: 'wife@example.com', household: 'Home' });
		expect(users.listPendingInvites(o.householdId)).toHaveLength(1);

		const m = await users.acceptInvite(token, { name: 'Wife', password: 'password-9' });
		expect(m).toMatchObject({ role: 'member', householdId: o.householdId, emailVerified: true });
		expect(users.listMembers(o.householdId).map((x) => x.name)).toEqual(['Scott', 'Wife']);
		expect(users.listPendingInvites(o.householdId)).toHaveLength(0);
	});

	it('an invite works once', async () => {
		const o = await owner();
		const { token } = users.createInvite(o, 'wife@example.com');
		await users.acceptInvite(token, { name: 'Wife', password: 'password-9' });
		expect(users.peekInvite(token)).toBeNull();
		await expect(users.acceptInvite(token, { name: 'W2', password: 'password-9' })).rejects.toThrow(/expired|used/);
	});

	it('re-inviting replaces the old link', async () => {
		const o = await owner();
		const first = users.createInvite(o, 'wife@example.com').token;
		const second = users.createInvite(o, 'wife@example.com').token;
		expect(users.peekInvite(first)).toBeNull();
		expect(users.peekInvite(second)).not.toBeNull();
	});

	it('expired invites are dead', async () => {
		const o = await owner();
		const { token } = users.createInvite(o, 'wife@example.com');
		db().prepare(`UPDATE email_tokens SET expires_at = '2000-01-01T00:00:00.000Z'`).run();
		expect(users.peekInvite(token)).toBeNull();
	});

	it('only the owner can invite, and not an existing account', async () => {
		const o = await owner();
		const { token } = users.createInvite(o, 'wife@example.com');
		const m = await users.acceptInvite(token, { name: 'Wife', password: 'password-9' });
		expect(() => users.createInvite(m, 'friend@example.com')).toThrow(/owner/);
		expect(() => users.createInvite(o, 'scott@example.com')).toThrow(/already has an account/);
	});

	it('the owner can revoke a pending invite', async () => {
		const o = await owner();
		const { token } = users.createInvite(o, 'wife@example.com');
		users.revokeInvite(o, 'wife@example.com');
		expect(users.peekInvite(token)).toBeNull();
	});
});

describe('password reset', () => {
	it('resets once, signs out other sessions, and verifies the email', async () => {
		const u = await owner();
		const token = users.createResetToken(u.id);
		expect(users.peekReset(token)).toEqual({ email: 'scott@example.com' });
		const after = await users.consumeReset(token, 'password-new');
		expect(after.sessionVersion).toBe(2);
		expect(after.emailVerified).toBe(true);
		expect(await users.authenticate(u.email, 'password-new')).not.toBeNull();
		await expect(users.consumeReset(token, 'password-x1')).rejects.toThrow(/expired|used/);
	});

	it('only the newest reset link works', async () => {
		const u = await owner();
		const old = users.createResetToken(u.id);
		users.createResetToken(u.id);
		expect(users.peekReset(old)).toBeNull();
	});
});

describe('email verification', () => {
	it('verifies once', async () => {
		const u = await owner();
		expect(u.emailVerified).toBe(false);
		const token = users.createVerifyToken(u.id);
		expect(users.consumeVerify(token)?.emailVerified).toBe(true);
		expect(users.consumeVerify(token)).toBeNull();
	});
});

describe('removing members', () => {
	it('owner removes a member; nobody removes the owner', async () => {
		const o = await owner();
		const { token } = users.createInvite(o, 'wife@example.com');
		const m = await users.acceptInvite(token, { name: 'Wife', password: 'password-9' });
		expect(() => users.removeMember(m, o.id)).toThrow(/owner/);
		expect(() => users.removeMember(o, o.id)).toThrow(/can't be removed/);
		users.removeMember(o, m.id);
		expect(users.getUser(m.id)).toBeNull();
	});
});

describe('credentials', () => {
	it('stores secrets encrypted and hands them back decrypted', async () => {
		const u = await owner();
		users.setFloppyToken(u.id, ' flp_abc ');
		users.setCalendarToken(u.id, 'cal_123');
		users.setBookOrbit(u.id, { username: 'scott', password: 'bo-pass', libraryId: 2 });
		users.setHardcoverToken(u.id, 'hc_mine');

		const raw = db().prepare('SELECT * FROM users WHERE id = ?').get(u.id) as Record<string, unknown>;
		expect(String(raw.floppy_token_enc)).not.toContain('flp_abc');
		expect(String(raw.bookorbit_password_enc)).not.toContain('bo-pass');
		expect(String(raw.hardcover_token_enc)).not.toContain('hc_mine');

		expect(users.getCredentials(u.id)).toEqual({
			floppyToken: 'flp_abc',
			calendarToken: 'cal_123',
			bookorbit: { username: 'scott', password: 'bo-pass', libraryId: 2 },
			hardcoverToken: 'hc_mine'
		});
		expect(users.linkedStatus(u.id)).toEqual({
			floppy: true,
			bookorbit: { username: 'scott', libraryId: 2 },
			hardcover: true
		});
	});

	it('clearing a credential unlinks it', async () => {
		const u = await owner();
		users.setFloppyToken(u.id, 'flp_abc');
		users.setFloppyToken(u.id, null);
		users.setBookOrbit(u.id, null);
		expect(users.getCredentials(u.id)).toEqual({ floppyToken: null, calendarToken: null, bookorbit: null, hardcoverToken: null });
		expect(users.linkedStatus(u.id).floppy).toBe(false);
	});
});

describe('per-user state', () => {
	it('keeps prefs JSON and notification guards per account', async () => {
		const u = await owner();
		expect(users.getPrefsJson(u.id)).toBeNull();
		users.setPrefsJson(u.id, '{"accent":"teal"}');
		expect(users.getPrefsJson(u.id)).toBe('{"accent":"teal"}');
		users.setNotifyState(u.id, { lastDigest: '2026-10-03' });
		expect(users.getNotifyState(u.id)).toEqual({ lastDigest: '2026-10-03', lastAtTime: null });
	});
});
