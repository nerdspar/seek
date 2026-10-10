/**
 * Whose work is this? The per-request (or per-job) user context.
 *
 * hooks.server.ts runs every signed-in request inside `runAs(user, …)`, and
 * background jobs (warmup, digest, anime sync) run *as* a specific user too.
 * Everything that touches per-person data reads from here instead of a global:
 *
 * - memo() and the per-user caches namespace their keys by user, so one
 *   person's cached watchlist can never be served to the other;
 * - the books client takes this user's BookOrbit login and Hardcover token.
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

/* Decrypted once per request/job and reused. */
function creds(ctx: Ctx): Credentials {
	ctx.creds ??= getCredentials(ctx.user.id);
	return ctx.creds;
}

export type LinkedService = 'bookorbit' | 'hardcover';

const NOT_LINKED: Record<LinkedService, string> = {
	bookorbit: 'No BookOrbit account linked — add your BookOrbit login in Settings → Your accounts.',
	hardcover: 'No Hardcover account linked — add your Hardcover token in Settings → Your accounts.'
};

/** This person hasn't connected the service a feature needs. The message is
 *  meant to be shown as-is. */
export class NotLinkedError extends Error {
	constructor(readonly service: LinkedService) {
		super(NOT_LINKED[service]);
		this.name = 'NotLinkedError';
	}
}

export type BookOrbitLogin = { username: string; password: string; libraryId: number | null };

/** This person's BookOrbit login, or null when they have none. */
export function bookorbitLogin(): BookOrbitLogin | null {
	const ctx = als.getStore();
	return ctx ? creds(ctx).bookorbit : null;
}

/** This person's own Hardcover token (their reading history there), or null.
 *  Catalog queries use the household's token; this one only reads "me". */
export function hardcoverUserToken(): string | null {
	const ctx = als.getStore();
	return ctx ? creds(ctx).hardcoverToken : null;
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
