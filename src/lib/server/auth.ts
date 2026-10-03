/**
 * Glue for the account pages (login, setup, invite, reset): the session cookie,
 * a safe post-login redirect, and the shared brute-force throttle.
 */
import type { Cookies } from '@sveltejs/kit';
import {
	COOKIE,
	SESSION_MAX_AGE_MS,
	describeWait,
	failureDelay,
	issue,
	lockedFor,
	noteFailure,
	noteSuccess
} from './session';
import type { User } from './users';

export function setSession(cookies: Cookies, url: URL, user: User): void {
	cookies.set(COOKIE, issue(user.id, user.sessionVersion), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		/* LAN access is plain HTTP and a Secure cookie would be dropped there,
		   so this follows the request rather than being pinned either way. Note
		   that a TLS-terminating proxy makes every request look like HTTP to
		   node unless PROTOCOL_HEADER is set — DEPLOY.md covers it. */
		secure: url.protocol === 'https:',
		maxAge: SESSION_MAX_AGE_MS / 1000
	});
}

export function clearSession(cookies: Cookies): void {
	cookies.delete(COOKIE, { path: '/' });
}

/** Where to go after signing in. Only a same-site path is accepted — a full URL
 *  or a protocol-relative `//host` would make the login page an open redirect. */
export function safeNext(raw: string | null | undefined): string {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
	return raw;
}

export type Throttled<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

/**
 * Run a credential check under the brute-force throttle. `check` returns the
 * value on success or null on a wrong answer; wrong answers count toward a
 * lockout and pay a flat delay before replying, so a scripted run can't go fast.
 *
 * Behind a tunnel every request arrives from the proxy, so the key is only a
 * real per-client one when ADDRESS_HEADER is set (see DEPLOY.md). If it is not,
 * the throttle degrades to a global one — which still stops guessing.
 */
export async function throttled<T>(
	who: string,
	wrongMessage: string,
	check: () => Promise<T | null>
): Promise<Throttled<T>> {
	const wait = lockedFor(who);
	if (wait > 0) return { ok: false, status: 429, error: `Too many attempts. Try again in ${describeWait(wait)}.` };

	const value = await check();
	if (value === null) {
		const penalty = noteFailure(who);
		await failureDelay();
		return {
			ok: false,
			status: 401,
			error: penalty ? `${wrongMessage} Locked for ${describeWait(penalty)}.` : wrongMessage
		};
	}
	noteSuccess(who);
	return { ok: true, value };
}
