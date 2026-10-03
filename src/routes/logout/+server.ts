import { redirect } from '@sveltejs/kit';
import { clearSession, safeNext } from '$lib/server/auth';
import { signOutEverywhere } from '$lib/server/users';
import type { RequestHandler } from './$types';

/**
 * Sign out. POST only (a GET link could be triggered by a prefetch or an <img>).
 * `?everywhere=1` also invalidates every other device's session by bumping the
 * account's session version. `?next=` returns somewhere specific afterwards —
 * e.g. back to an invite link that needed a signed-out browser.
 */
export const POST: RequestHandler = async ({ cookies, url, locals }) => {
	if (url.searchParams.get('everywhere') === '1' && locals.user) signOutEverywhere(locals.user.id);
	clearSession(cookies);
	const next = url.searchParams.get('next');
	redirect(303, next ? safeNext(next) : '/login');
};
