/**
 * Household accounts (docs/household-multiuser-plan.md, phase A + C storage).
 *
 * One household for now (you and your wife); built so more households is an
 * extension, not a rewrite. Signup is never open: the first account is created
 * through the bootstrap setup page, and everyone after that joins by an invite
 * the owner issues.
 */
import { db, nowIso } from './db';
import {
	hashPassword,
	verifyPassword,
	newOpaqueToken,
	hashToken,
	encryptSecret,
	decryptSecret
} from './crypto';

export type Role = 'owner' | 'member';

/** The safe, public view of an account — no hashes, no secrets. */
export type User = {
	id: number;
	householdId: number;
	email: string;
	name: string;
	role: Role;
	sessionVersion: number;
	emailVerified: boolean;
};

type UserRow = {
	id: number;
	household_id: number;
	email: string;
	name: string;
	password_hash: string;
	role: Role;
	session_version: number;
	email_verified_at: string | null;
	floppy_token_enc: string | null;
	floppy_calendar_token_enc: string | null;
	bookorbit_username: string | null;
	bookorbit_password_enc: string | null;
	bookorbit_library_id: number | null;
	hardcover_token_enc: string | null;
	prefs_json: string | null;
	last_digest: string | null;
	last_at_time: string | null;
};

/** Thrown for anything the person can fix — the message is shown to them. */
export class AccountError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AccountError';
	}
}

const toUser = (r: UserRow): User => ({
	id: r.id,
	householdId: r.household_id,
	email: r.email,
	name: r.name,
	role: r.role,
	sessionVersion: r.session_version,
	emailVerified: Boolean(r.email_verified_at)
});

export const MIN_PASSWORD = 8;

export function normalizeEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

function checkEmail(email: string): void {
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError('Enter a valid email address.');
}

function checkPassword(password: string): void {
	if (password.length < MIN_PASSWORD) {
		throw new AccountError(`Use at least ${MIN_PASSWORD} characters for the password.`);
	}
}

function checkName(name: string): string {
	const n = name.trim();
	if (!n) throw new AccountError('Enter a name.');
	if (n.length > 60) throw new AccountError('Keep the name under 60 characters.');
	return n;
}

const row = (id: number) =>
	db().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

export const userCount = () =>
	(db().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;

export function getUser(id: number): User | null {
	const r = row(id);
	return r ? toUser(r) : null;
}

export function getUserByEmail(email: string): User | null {
	const r = db().prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email)) as
		| UserRow
		| undefined;
	return r ? toUser(r) : null;
}

export function getOwner(): User | null {
	const r = db().prepare(`SELECT * FROM users WHERE role = 'owner' ORDER BY id LIMIT 1`).get() as
		| UserRow
		| undefined;
	return r ? toUser(r) : null;
}

export function listUsers(): User[] {
	return (db().prepare('SELECT * FROM users ORDER BY id').all() as UserRow[]).map(toUser);
}

export function listMembers(householdId: number): User[] {
	return (
		db().prepare('SELECT * FROM users WHERE household_id = ? ORDER BY id').all(householdId) as UserRow[]
	).map(toUser);
}

export function householdName(householdId: number): string {
	const r = db().prepare('SELECT name FROM households WHERE id = ?').get(householdId) as
		| { name: string }
		| undefined;
	return r?.name ?? 'Household';
}

/** Bootstrap: the very first account, which owns the household. Refuses once any
 *  account exists — after that, people join by invite. */
export async function createOwner(input: {
	email: string;
	name: string;
	password: string;
	householdName?: string;
}): Promise<User> {
	const email = normalizeEmail(input.email);
	checkEmail(email);
	const name = checkName(input.name);
	checkPassword(input.password);
	const hash = await hashPassword(input.password);

	const id = db().transaction(() => {
		if (userCount() > 0) throw new AccountError('Seek is already set up — sign in instead.');
		const now = nowIso();
		const household = db()
			.prepare('INSERT INTO households (name, created_at) VALUES (?, ?)')
			.run(input.householdName?.trim() || 'Home', now);
		return db()
			.prepare(
				`INSERT INTO users (household_id, email, name, password_hash, role, created_at)
				 VALUES (?, ?, ?, ?, 'owner', ?)`
			)
			.run(household.lastInsertRowid, email, name, hash, now).lastInsertRowid as number;
	})();
	return getUser(id)!;
}

/* Verifying against a real hash even when the email is unknown keeps the
   response time the same either way, so a timing difference can't reveal which
   emails have accounts. */
let dummyHash: Promise<string> | null = null;

export async function authenticate(email: string, password: string): Promise<User | null> {
	const r = db().prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email)) as
		| UserRow
		| undefined;
	if (!r) {
		dummyHash ??= hashPassword('not-a-real-password');
		await verifyPassword(password, await dummyHash);
		return null;
	}
	return (await verifyPassword(password, r.password_hash)) ? toUser(r) : null;
}

/** Set a new password and sign the account out everywhere else. */
export async function setPassword(userId: number, password: string): Promise<User> {
	checkPassword(password);
	const hash = await hashPassword(password);
	db()
		.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?')
		.run(hash, userId);
	return getUser(userId)!;
}

export async function changePassword(userId: number, current: string, next: string): Promise<User> {
	const r = row(userId);
	if (!r || !(await verifyPassword(current, r.password_hash))) {
		throw new AccountError('Your current password is incorrect.');
	}
	return setPassword(userId, next);
}

/** Invalidate every outstanding session for this account. */
export function signOutEverywhere(userId: number): void {
	db().prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(userId);
}

export function renameUser(userId: number, name: string): User {
	db().prepare('UPDATE users SET name = ? WHERE id = ?').run(checkName(name), userId);
	return getUser(userId)!;
}

export function markEmailVerified(userId: number): void {
	db().prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(nowIso(), userId);
}

/** Owner removes a member. The owner can't be removed this way. */
export function removeMember(actor: User, userId: number): void {
	if (actor.role !== 'owner') throw new AccountError('Only the household owner can remove people.');
	const target = row(userId);
	if (!target || target.household_id !== actor.householdId) throw new AccountError('No such member.');
	if (target.role === 'owner') throw new AccountError("The owner's account can't be removed.");
	db().prepare('DELETE FROM users WHERE id = ?').run(userId);
}

/* ---------------------------------------------------------------- tokens */

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;
export const VERIFY_TTL_MS = 3 * 24 * 60 * 60 * 1000;

type TokenRow = {
	id: number;
	kind: 'invite' | 'verify' | 'reset';
	user_id: number | null;
	household_id: number | null;
	email: string | null;
	expires_at: string;
	used_at: string | null;
};

/** A live (unused, unexpired) token of the given kind, or null. */
function liveToken(kind: TokenRow['kind'], token: string): TokenRow | null {
	const r = db()
		.prepare('SELECT * FROM email_tokens WHERE token_hash = ? AND kind = ?')
		.get(hashToken(token), kind) as TokenRow | undefined;
	if (!r || r.used_at || new Date(r.expires_at).getTime() <= Date.now()) return null;
	return r;
}

function issueToken(row: {
	kind: TokenRow['kind'];
	userId?: number | null;
	householdId?: number | null;
	email?: string | null;
	ttlMs: number;
}): string {
	const { token, hash } = newOpaqueToken();
	db()
		.prepare(
			`INSERT INTO email_tokens (kind, user_id, household_id, email, token_hash, expires_at, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			row.kind,
			row.userId ?? null,
			row.householdId ?? null,
			row.email ?? null,
			hash,
			new Date(Date.now() + row.ttlMs).toISOString(),
			nowIso()
		);
	return token;
}

/** Owner invites someone to the household. Re-inviting the same email replaces
 *  the previous (unused) invite, so only the newest link works. */
export function createInvite(actor: User, rawEmail: string): { token: string; email: string } {
	if (actor.role !== 'owner') throw new AccountError('Only the household owner can invite people.');
	const email = normalizeEmail(rawEmail);
	checkEmail(email);
	if (getUserByEmail(email)) throw new AccountError('That email already has an account.');
	db()
		.prepare(`DELETE FROM email_tokens WHERE kind = 'invite' AND email = ? AND used_at IS NULL`)
		.run(email);
	return { token: issueToken({ kind: 'invite', householdId: actor.householdId, email, ttlMs: INVITE_TTL_MS }), email };
}

export type PendingInvite = { email: string; expiresAt: string };

export function listPendingInvites(householdId: number): PendingInvite[] {
	return (
		db()
			.prepare(
				`SELECT email, expires_at FROM email_tokens
				 WHERE kind = 'invite' AND household_id = ? AND used_at IS NULL AND expires_at > ?
				 ORDER BY created_at`
			)
			.all(householdId, nowIso()) as { email: string; expires_at: string }[]
	).map((r) => ({ email: r.email, expiresAt: r.expires_at }));
}

export function revokeInvite(actor: User, email: string): void {
	if (actor.role !== 'owner') throw new AccountError('Only the household owner can manage invites.');
	db()
		.prepare(`DELETE FROM email_tokens WHERE kind = 'invite' AND household_id = ? AND email = ? AND used_at IS NULL`)
		.run(actor.householdId, normalizeEmail(email));
}

export function peekInvite(token: string): { email: string; household: string } | null {
	const r = liveToken('invite', token);
	if (!r || !r.email || !r.household_id) return null;
	return { email: r.email, household: householdName(r.household_id) };
}

/** Redeem an invite: creates the member account. Receiving the invite link is
 *  the proof of the address, so the email counts as verified. */
export async function acceptInvite(token: string, input: { name: string; password: string }): Promise<User> {
	const name = checkName(input.name);
	checkPassword(input.password);
	const hash = await hashPassword(input.password);

	const id = db().transaction(() => {
		const r = liveToken('invite', token);
		if (!r || !r.email || !r.household_id) throw new AccountError('This invite link has expired or was already used.');
		if (getUserByEmail(r.email)) throw new AccountError('That email already has an account — sign in instead.');
		const now = nowIso();
		const created = db()
			.prepare(
				`INSERT INTO users (household_id, email, name, password_hash, role, email_verified_at, created_at)
				 VALUES (?, ?, ?, ?, 'member', ?, ?)`
			)
			.run(r.household_id, r.email, name, hash, now, now);
		db().prepare('UPDATE email_tokens SET used_at = ? WHERE id = ?').run(now, r.id);
		return created.lastInsertRowid as number;
	})();
	return getUser(id)!;
}

/** A password-reset link for this account (emailed, or handed over by the owner). */
export function createResetToken(userId: number): string {
	// Only the newest reset link works.
	db().prepare(`DELETE FROM email_tokens WHERE kind = 'reset' AND user_id = ? AND used_at IS NULL`).run(userId);
	return issueToken({ kind: 'reset', userId, ttlMs: RESET_TTL_MS });
}

export function peekReset(token: string): { email: string } | null {
	const r = liveToken('reset', token);
	const u = r?.user_id ? getUser(r.user_id) : null;
	return u ? { email: u.email } : null;
}

export async function consumeReset(token: string, password: string): Promise<User> {
	checkPassword(password);
	const r = liveToken('reset', token);
	if (!r?.user_id) throw new AccountError('This reset link has expired or was already used.');
	db().prepare('UPDATE email_tokens SET used_at = ? WHERE id = ?').run(nowIso(), r.id);
	// The reset proves control of the inbox too.
	markEmailVerified(r.user_id);
	return setPassword(r.user_id, password);
}

export function createVerifyToken(userId: number): string {
	db().prepare(`DELETE FROM email_tokens WHERE kind = 'verify' AND user_id = ? AND used_at IS NULL`).run(userId);
	return issueToken({ kind: 'verify', userId, ttlMs: VERIFY_TTL_MS });
}

export function consumeVerify(token: string): User | null {
	const r = liveToken('verify', token);
	if (!r?.user_id) return null;
	db().prepare('UPDATE email_tokens SET used_at = ? WHERE id = ?').run(nowIso(), r.id);
	markEmailVerified(r.user_id);
	return getUser(r.user_id);
}

/* ----------------------------------------------------------- credentials */

/** Credentials Seek uses on someone's behalf, decrypted. Server-only. */
export type Credentials = {
	bookorbit: { username: string; password: string; libraryId: number | null } | null;
	hardcoverToken: string | null;
};

const dec = (v: string | null) => (v ? decryptSecret(v) : null);

export function getCredentials(userId: number): Credentials {
	const r = row(userId);
	if (!r) return { bookorbit: null, hardcoverToken: null };
	const boPassword = dec(r.bookorbit_password_enc);
	return {
		bookorbit:
			r.bookorbit_username && boPassword
				? { username: r.bookorbit_username, password: boPassword, libraryId: r.bookorbit_library_id }
				: null,
		hardcoverToken: dec(r.hardcover_token_enc)
	};
}

/** Which credentials are linked — safe to send to the browser. */
export type LinkedStatus = {
	bookorbit: { username: string; libraryId: number | null } | null;
	hardcover: boolean;
};

export function linkedStatus(userId: number): LinkedStatus {
	const r = row(userId);
	return {
		bookorbit: r?.bookorbit_username
			? { username: r.bookorbit_username, libraryId: r.bookorbit_library_id }
			: null,
		hardcover: Boolean(r?.hardcover_token_enc)
	};
}

const enc = (v: string | null) => (v ? encryptSecret(v) : null);

export function setHardcoverToken(userId: number, token: string | null): void {
	db().prepare('UPDATE users SET hardcover_token_enc = ? WHERE id = ?').run(enc(token?.trim() || null), userId);
}

export function setBookOrbit(
	userId: number,
	login: { username: string; password: string; libraryId: number | null } | null
): void {
	db()
		.prepare(
			'UPDATE users SET bookorbit_username = ?, bookorbit_password_enc = ?, bookorbit_library_id = ? WHERE id = ?'
		)
		.run(
			login?.username.trim() || null,
			login ? enc(login.password) : null,
			login?.libraryId ?? null,
			userId
		);
}

export function setBookOrbitLibrary(userId: number, libraryId: number | null): void {
	db().prepare('UPDATE users SET bookorbit_library_id = ? WHERE id = ?').run(libraryId, userId);
}

/* ------------------------------------------------------------- per-user state */

export function getPrefsJson(userId: number): string | null {
	return row(userId)?.prefs_json ?? null;
}

export function setPrefsJson(userId: number, json: string): void {
	db().prepare('UPDATE users SET prefs_json = ? WHERE id = ?').run(json, userId);
}

export function getNotifyState(userId: number): { lastDigest: string | null; lastAtTime: string | null } {
	const r = row(userId);
	return { lastDigest: r?.last_digest ?? null, lastAtTime: r?.last_at_time ?? null };
}

export function setNotifyState(userId: number, patch: { lastDigest?: string; lastAtTime?: string }): void {
	if (patch.lastDigest !== undefined) db().prepare('UPDATE users SET last_digest = ? WHERE id = ?').run(patch.lastDigest, userId);
	if (patch.lastAtTime !== undefined) db().prepare('UPDATE users SET last_at_time = ? WHERE id = ?').run(patch.lastAtTime, userId);
}

/* ── Seek's own Jellyfin webhook (own-tracking plan, step 4) ───────────────── */

/** This person's private webhook token, created on first ask. The URL is the
 *  credential, so it's long and random. */
export function jellyfinToken(userId: number): string {
	const have = db().prepare('SELECT jellyfin_token FROM users WHERE id = ?').get(userId) as { jellyfin_token: string | null } | undefined;
	if (have?.jellyfin_token) return have.jellyfin_token;
	const { token } = newOpaqueToken();
	db().prepare('UPDATE users SET jellyfin_token = ? WHERE id = ?').run(token, userId);
	return token;
}

/** This person's private Upcoming feed token, created on first ask. Read-only,
 *  and separate from the webhook's: the URL is the credential. */
export function feedToken(userId: number): string {
	const have = db().prepare('SELECT feed_token FROM users WHERE id = ?').get(userId) as { feed_token: string | null } | undefined;
	if (have?.feed_token) return have.feed_token;
	const { token } = newOpaqueToken();
	db().prepare('UPDATE users SET feed_token = ? WHERE id = ?').run(token, userId);
	return token;
}

/** Whose feed this is, or null. */
export function userByFeedToken(token: string): User | null {
	if (!token || token.length < 20) return null;
	const r = db().prepare('SELECT id FROM users WHERE feed_token = ?').get(token) as { id: number } | undefined;
	return r ? getUser(r.id) : null;
}

/** Whose webhook this is, or null. */
export function userByJellyfinToken(token: string): User | null {
	if (!token || token.length < 20) return null;
	const r = db().prepare('SELECT id FROM users WHERE jellyfin_token = ?').get(token) as { id: number } | undefined;
	return r ? getUser(r.id) : null;
}
