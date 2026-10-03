/**
 * Whose work is this? The per-request (or per-job) user context.
 *
 * hooks.server.ts runs every signed-in request inside `runAs(user, …)`, and
 * background jobs (warmup, digest, anime sync) run *as* a specific user too.
 * Everything that touches per-person data reads from here instead of a global:
 *
 * - floppy() takes this user's Floppy token;
 * - memo() and the per-user caches namespace their keys by user, so one
 *   person's cached watchlist can never be served to the other;
 * - Upcoming takes this user's calendar token; the books client takes this
 *   user's BookOrbit login.
 *
 * The security rule: the household owner may fall back to the env credentials
 * (the pre-accounts config — your deployment keeps working with nothing linked).
 * A member never falls back. A member with nothing linked gets NotLinkedError,
 * never the owner's library.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from '$env/dynamic/private';
import { getCredentials, type Credentials, type User } from './users';

type Ctx = { user: User; creds?: Credentials };

const als = new AsyncLocalStorage<Ctx>();

export function runAs<T>(user: User, fn: () => T): T {
	return als.run({ user }, fn);
}

export function currentUser(): User | null {
	return als.getStore()?.user ?? null;
}

/* Decrypted once per request/job and reused — floppy() can be called ~90 times
   building one watchlist. */
function creds(ctx: Ctx): Credentials {
	ctx.creds ??= getCredentials(ctx.user.id);
	return ctx.creds;
}

export type LinkedService = 'floppy' | 'calendar' | 'bookorbit';

const NOT_LINKED: Record<LinkedService, string> = {
	floppy: 'No Floppy account linked — add your Floppy token in Settings → Your accounts.',
	calendar: 'No Floppy calendar linked — add your calendar token in Settings → Your accounts.',
	bookorbit: 'No BookOrbit account linked — add your BookOrbit login in Settings → Your accounts.'
};

/** This person hasn't connected the service a feature needs. The message is
 *  meant to be shown as-is. */
export class NotLinkedError extends Error {
	constructor(readonly service: LinkedService) {
		super(NOT_LINKED[service]);
		this.name = 'NotLinkedError';
	}
}

const isOwner = (ctx: Ctx) => ctx.user.role === 'owner';

/**
 * The Floppy token for whoever this work is for. Outside any user context
 * (legacy single-user paths) it is the env token, exactly as before accounts.
 */
export function floppyToken(): string {
	const ctx = als.getStore();
	if (!ctx) {
		if (!env.FLOPPY_TOKEN) throw new Error('Missing required env var FLOPPY_TOKEN. See .env.example.');
		return env.FLOPPY_TOKEN;
	}
	const token = creds(ctx).floppyToken ?? (isOwner(ctx) ? env.FLOPPY_TOKEN || null : null);
	if (!token) throw new NotLinkedError('floppy');
	return token;
}

/** The Floppy calendar (iCal) token, or null when this person has none. */
export function calendarToken(): string | null {
	const ctx = als.getStore();
	if (!ctx) return env.FLOPPY_CALENDAR_TOKEN || null;
	return creds(ctx).calendarToken ?? (isOwner(ctx) ? env.FLOPPY_CALENDAR_TOKEN || null : null);
}

export type BookOrbitLogin = { username: string; password: string; libraryId: number | null };

/** This person's BookOrbit login, or null when they have none. */
export function bookorbitLogin(): BookOrbitLogin | null {
	const ctx = als.getStore();
	const envLogin =
		env.BOOKORBIT_USER && env.BOOKORBIT_PASSWORD
			? { username: env.BOOKORBIT_USER, password: env.BOOKORBIT_PASSWORD, libraryId: null }
			: null;
	if (!ctx) return envLogin;
	return creds(ctx).bookorbit ?? (isOwner(ctx) ? envLogin : null);
}

/** Who a cache entry belongs to. 0 = no user context (boot / legacy paths). */
export function scopeId(): number {
	return als.getStore()?.user.id ?? 0;
}

/** A cache key namespaced to the current user. */
export const scopeKey = (key: string) => `u${scopeId()}:${key}`;

/** The key with its user namespace removed (for prefix checks). */
export const unscoped = (key: string) => key.replace(/^u\d+:/, '');

/** Forget the cached decrypted credentials, e.g. right after the user changes
 *  them mid-request, so the rest of the request uses the new ones. */
export function refreshCredentials(): void {
	const ctx = als.getStore();
	if (ctx) ctx.creds = undefined;
}
