import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { AccountError, createOwner, userCount } from '$lib/server/users';
import { passphraseMatches, setupTokenRequired } from '$lib/server/session';
import { tokenKeyConfigured } from '$lib/server/crypto';
import { setSession, throttled } from '$lib/server/auth';
import { importLegacyPush } from '$lib/server/push';
import { warmInBackground } from '$lib/server/warmup';
import type { Actions, PageServerLoad } from './$types';

/**
 * First run: create the household owner. Only reachable while there are no
 * accounts at all. When SEEK_PASSPHRASE is set (always, for an internet-facing
 * deployment) it must be entered here — that's what stops a stranger who finds
 * a freshly deployed Seek from claiming it.
 */
export const load: PageServerLoad = async () => {
	if (userCount() > 0) redirect(303, '/login');
	return {
		needsSetupToken: setupTokenRequired(),
		missingSessionSecret: !env.SEEK_SESSION_SECRET,
		missingTokenKey: !tokenKeyConfigured()
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		if (userCount() > 0) redirect(303, '/login');

		const data = await request.formData();
		const name = String(data.get('name') ?? '');
		const email = String(data.get('email') ?? '');
		const password = String(data.get('password') ?? '');
		const confirm = String(data.get('confirm') ?? '');
		const keep = { name, email };

		if (password !== confirm) return fail(400, { ...keep, error: "The passwords don't match." });

		if (setupTokenRequired()) {
			const token = String(data.get('setupToken') ?? '');
			const gate = await throttled(getClientAddress(), 'That setup passphrase is wrong.', async () =>
				passphraseMatches(token) ? true : null
			);
			if (!gate.ok) return fail(gate.status, { ...keep, error: gate.error });
		}

		let owner;
		try {
			owner = await createOwner({ name, email, password });
		} catch (err) {
			if (err instanceof AccountError) return fail(400, { ...keep, error: err.message });
			throw err;
		}

		// Devices that had notifications before accounts keep them, as the owner's.
		await importLegacyPush(owner.id).catch((err) => console.warn('[seek] legacy push import failed:', err));
		setSession(cookies, url, owner);
		warmInBackground(owner);
		redirect(303, '/');
	}
};
