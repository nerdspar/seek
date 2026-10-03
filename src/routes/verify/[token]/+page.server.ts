import { consumeVerify } from '$lib/server/users';
import type { PageServerLoad } from './$types';

/* Confirming on load is fine here: the outcome is idempotent (an address is
   either verified or not), so a mail scanner pre-fetching the link does no harm. */
export const load: PageServerLoad = async ({ params }) => {
	const user = consumeVerify(params.token);
	return { verified: Boolean(user), email: user?.email ?? null };
};
