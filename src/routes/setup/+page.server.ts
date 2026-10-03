import { fail, redirect } from '@sveltejs/kit';
import { AccountError, createOwner, userCount } from '$lib/server/users';
import { announceSetupCode, setupCodeIsPassphrase, setupCodeMatches } from '$lib/server/session';
import { setSession, throttled } from '$lib/server/auth';
import { importLegacyPush } from '$lib/server/push';
import { importEnvCredentials } from '$lib/server/upgrade';
import { floppyConfigured } from '$lib/server/env';
import { warmInBackground } from '$lib/server/warmup';
import type { Actions, PageServerLoad } from './$types';

/**
 * First run: create the household owner. Only reachable while there are no
 * accounts at all, and only with the setup code — printed in Seek's log on boot
 * (or the old SEEK_PASSPHRASE on an upgraded deployment). That's what stops a
 * stranger who finds a freshly deployed Seek from claiming it.
 */
export const load: PageServerLoad = async () => {
	if (userCount() > 0) redirect(303, '/login');
	// Print it again, in case the boot lines have scrolled out of the log view.
	announceSetupCode();
	return { passphrase: setupCodeIsPassphrase() };
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

		const code = String(data.get('setupToken') ?? '');
		const gate = await throttled(getClientAddress(), 'That setup code is wrong.', async () =>
			setupCodeMatches(code) ? true : null
		);
		if (!gate.ok) return fail(gate.status, { ...keep, error: gate.error });

		let owner;
		try {
			owner = await createOwner({ name, email, password });
		} catch (err) {
			if (err instanceof AccountError) return fail(400, { ...keep, error: err.message });
			throw err;
		}

		// An upgraded deployment: the old env Floppy/BookOrbit logins become yours.
		importEnvCredentials();
		// Devices that had notifications before accounts keep them, as the owner's.
		await importLegacyPush(owner.id).catch((err) => console.warn('[seek] legacy push import failed:', err));
		setSession(cookies, url, owner);
		warmInBackground(owner);
		// A brand-new install has nothing to show until Floppy is connected.
		redirect(303, floppyConfigured() ? '/' : '/profile/settings?welcome=1#services');
	}
};
