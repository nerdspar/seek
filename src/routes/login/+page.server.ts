import { fail, redirect } from '@sveltejs/kit';
import {
	COOKIE,
	SESSION_MAX_AGE_MS,
	describeWait,
	failureDelay,
	gateEnabled,
	issue,
	lockedFor,
	noteFailure,
	noteSuccess,
	passphraseMatches
} from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	if (!gateEnabled()) redirect(303, '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		/* Behind a tunnel every request arrives from the proxy, so this is only a
		   real per-client key when ADDRESS_HEADER is set (see DEPLOY.md). If it is
		   not, the throttle degrades to a global one — which still stops guessing,
		   and cannot lock out anyone already holding a valid cookie, because the
		   gate only sends unauthenticated requests here. */
		const who = getClientAddress();

		const wait = lockedFor(who);
		if (wait > 0) {
			return fail(429, { error: `Too many attempts. Try again in ${describeWait(wait)}.` });
		}

		const data = await request.formData();
		const passphrase = String(data.get('passphrase') ?? '');

		if (!passphraseMatches(passphrase)) {
			const penalty = noteFailure(who);
			// Paid before replying, so a scripted run cannot go faster than this.
			await failureDelay();
			return fail(401, {
				error: penalty
					? `Incorrect passphrase. Locked for ${describeWait(penalty)}.`
					: 'Incorrect passphrase.'
			});
		}

		noteSuccess(who);
		cookies.set(COOKIE, issue(), {
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
		redirect(303, '/');
	}
};
