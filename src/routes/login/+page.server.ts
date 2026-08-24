import { fail, redirect } from '@sveltejs/kit';
import { COOKIE, gateEnabled, issue, passphraseMatches } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	if (!gateEnabled()) redirect(303, '/');
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const passphrase = String(data.get('passphrase') ?? '');

		if (!passphraseMatches(passphrase)) return fail(401, { error: 'Incorrect passphrase.' });

		cookies.set(COOKIE, issue(), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			// LAN deployment is plain HTTP; requiring Secure would break the cookie.
			secure: false,
			maxAge: 60 * 60 * 24 * 365
		});
		redirect(303, '/');
	}
};
