import { fail } from '@sveltejs/kit';
import { createResetToken, getOwner, getUserByEmail } from '$lib/server/users';
import { describeWait, lockedFor, noteFailure } from '$lib/server/session';
import { mailConfigured, resetMail, sendMail } from '$lib/server/mail';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	mail: mailConfigured(),
	ownerName: getOwner()?.name ?? null
});

export const actions: Actions = {
	default: async ({ request, url, getClientAddress }) => {
		if (!mailConfigured()) return fail(400, { error: 'Email isn’t set up on this Seek.' });

		/* Every request counts toward the throttle, found or not: this sends
		   email, so it must not be usable to flood someone's inbox. */
		const who = getClientAddress();
		const wait = lockedFor(who);
		if (wait > 0) return fail(429, { error: `Too many requests. Try again in ${describeWait(wait)}.` });
		noteFailure(who);

		const email = String((await request.formData()).get('email') ?? '');
		const user = getUserByEmail(email);
		if (user) {
			const token = createResetToken(user.id);
			try {
				await sendMail(resetMail(user.email, `${url.origin}/reset/${token}`));
			} catch (err) {
				console.warn('[seek] reset email failed:', err);
			}
		}
		/* The same answer either way, so this can't be used to discover which
		   addresses have accounts. */
		return { sent: true };
	}
};
