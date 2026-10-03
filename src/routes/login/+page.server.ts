import { fail, redirect } from '@sveltejs/kit';
import { authenticate, userCount } from '$lib/server/users';
import { setSession, safeNext, throttled } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (userCount() === 0) redirect(303, '/setup');
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
	return { next: url.searchParams.get('next') ?? '' };
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const data = await request.formData();
		const email = String(data.get('email') ?? '');
		const password = String(data.get('password') ?? '');
		const next = String(data.get('next') ?? '');

		const result = await throttled(getClientAddress(), 'Wrong email or password.', () =>
			authenticate(email, password)
		);
		if (!result.ok) return fail(result.status, { error: result.error, email });

		setSession(cookies, url, result.value);
		redirect(303, safeNext(next));
	}
};
