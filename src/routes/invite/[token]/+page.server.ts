import { fail, redirect } from '@sveltejs/kit';
import { AccountError, acceptInvite, peekInvite } from '$lib/server/users';
import { setSession } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	return {
		invite: peekInvite(params.token),
		// Where sign-out should come back to: this same invite.
		self: url.pathname,
		// Someone already signed in (say, the owner checking the link) must sign
		// out first, or accepting would silently switch accounts.
		signedInAs: locals.user?.email ?? null
	};
};

export const actions: Actions = {
	default: async ({ params, request, cookies, url }) => {
		const data = await request.formData();
		const name = String(data.get('name') ?? '');
		const password = String(data.get('password') ?? '');
		if (password !== String(data.get('confirm') ?? '')) {
			return fail(400, { name, error: "The passwords don't match." });
		}
		let user;
		try {
			user = await acceptInvite(params.token, { name, password });
		} catch (err) {
			if (err instanceof AccountError) return fail(400, { name, error: err.message });
			throw err;
		}
		setSession(cookies, url, user);
		// Straight to account settings, to link their own BookOrbit / Hardcover.
		redirect(303, '/profile/settings?s=accounts&welcome=1');
	}
};
