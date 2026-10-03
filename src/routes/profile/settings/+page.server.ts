import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { FLOPPY_PUBLIC_URL } from '$lib/server/env';
import { DEFAULT_PRESET_LABELS } from '$lib/server/tmdb';
import { householdName, linkedStatus, listMembers, listPendingInvites } from '$lib/server/users';
import { mailConfigured } from '$lib/server/mail';
import { tokenKeyConfigured } from '$lib/server/crypto';
import { bookorbitConfigured } from '$lib/server/books/bookorbit';
import type { PageServerLoad } from './$types';

/* Awaited rather than streamed. Preferences are a single small read and the
   whole page is controls bound to them — a skeleton here would flash for a few
   milliseconds and then be replaced, which is worse than waiting for it. */
export const load: PageServerLoad = async ({ locals }) => {
	const me = locals.user;
	if (!me) error(401);
	const publicUrl = FLOPPY_PUBLIC_URL();
	return {
		prefs: await getPrefs(),
		defaultPresets: DEFAULT_PRESET_LABELS(),
		/* Verified against the running instance: Floppy has no bare /settings/
		   route and its settings paths carry no trailing slash, so `/settings/`
		   404s. Lands on notifications because that is what this row points at. */
		floppyUrl: publicUrl ? `${publicUrl}/settings/notifications` : null,
		/* The commit this build came from (CI stamps it; "dev" locally), so the
		   deployed version is visible at a glance. */
		build: env.SEEK_BUILD_SHA || 'dev',
		account: {
			me,
			mail: mailConfigured(),
			household: {
				name: householdName(me.householdId),
				members: listMembers(me.householdId),
				invites: me.role === 'owner' ? listPendingInvites(me.householdId) : []
			},
			linked: linkedStatus(me.id),
			canStore: tokenKeyConfigured(),
			bookorbit: bookorbitConfigured(),
			// The owner runs on the deployment's env config until they link their own.
			envFallback: {
				floppy: me.role === 'owner' && Boolean(env.FLOPPY_TOKEN),
				calendar: me.role === 'owner' && Boolean(env.FLOPPY_CALENDAR_TOKEN),
				bookorbit: me.role === 'owner' && Boolean(env.BOOKORBIT_USER && env.BOOKORBIT_PASSWORD)
			}
		}
	};
};
