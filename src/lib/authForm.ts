/**
 * `use:enhance` submit handler shared by the account pages. Tracks `busy`, and
 * catches the failure that otherwise looks like silence: a rejected request
 * never reaches `form`, so the page would sit there saying nothing — which is
 * exactly how it looks when the origin check fails and every submission 403s.
 * Pass a `$state` object; this mutates it.
 */
export type AuthFormState = { busy: boolean; trouble: string | null };

export const ORIGIN_TROUBLE =
	'Seek could not process that. If Seek sits behind a reverse proxy, ORIGIN is probably unset or wrong — see DEPLOY.md.';

export function authSubmit(state: AuthFormState) {
	return () => {
		state.busy = true;
		state.trouble = null;
		return async ({
			result,
			update
		}: {
			result: { type: string };
			update: (opts?: { reset?: boolean }) => Promise<void>;
		}) => {
			state.busy = false;
			/* A wrong answer and a lockout both come back as `failure` and render
			   through `form`. Anything else means the request never reached the
			   action, and the operator is the one who has to fix it. */
			if (!['failure', 'redirect', 'success'].includes(result.type)) state.trouble = ORIGIN_TROUBLE;
			// Keep what was typed on a failure, so a typo doesn't mean starting over.
			await update({ reset: false });
		};
	};
}
