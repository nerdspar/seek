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
 * The security rule: nobody runs on anyone else's credentials. Each person —
 * owner included — uses only what they linked under Your accounts (an upgraded
 * deployment's old env tokens are copied onto the owner's account once, see
 * upgrade.ts). Nothing linked means NotLinkedError, never someone else's library.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
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

/** Work that touches someone's accounts must say whose; outside any user
 *  context there is nobody to act for. */
function ctxOrThrow(): Ctx {
	const ctx = als.getStore();
	if (!ctx) throw new Error('No user context — run this as someone (runAs).');
	return ctx;
}

/** The Floppy token for whoever this work is for. */
export function floppyToken(): string {
	const token = creds(ctxOrThrow()).floppyToken;
	if (!token) throw new NotLinkedError('floppy');
	return token;
}

/** The Floppy calendar (iCal) token, or null when this person has none. */
export function calendarToken(): string | null {
	const ctx = als.getStore();
	return ctx ? creds(ctx).calendarToken : null;
}

export type BookOrbitLogin = { username: string; password: string; libraryId: number | null };

/** This person's BookOrbit login, or null when they have none. */
export function bookorbitLogin(): BookOrbitLogin | null {
	const ctx = als.getStore();
	return ctx ? creds(ctx).bookorbit : null;
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
