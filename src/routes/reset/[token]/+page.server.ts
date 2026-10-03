import { fail, redirect } from '@sveltejs/kit';
import { AccountError, consumeReset, peekReset } from '$lib/server/users';
import { setSession } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => ({ reset: peekReset(params.token) });

export const actions: Actions = {
	default: async ({ params, request, cookies, url }) => {
		const data = await request.formData();
		const password = String(data.get('password') ?? '');
		if (password !== String(data.get('confirm') ?? '')) return fail(400, { error: "The passwords don't match." });
		let user;
		try {
			// Also signs every other device out (session version bump).
			user = await consumeReset(params.token, password);
		} catch (err) {
			if (err instanceof AccountError) return fail(400, { error: err.message });
			throw err;
		}
		setSession(cookies, url, user);
		redirect(303, '/');
	}
};
