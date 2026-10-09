import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { FLOPPY_PUBLIC_URL, floppyConfigured } from '$lib/server/env';
import { DEFAULT_PRESET_LABELS } from '$lib/server/tmdb';
import { householdName, jellyfinToken, linkedStatus, listMembers, listPendingInvites } from '$lib/server/users';
import { recentUnmatched } from '$lib/server/tracking/jellyfin';
import { mailConfigured } from '$lib/server/mail';
import { settingsForDisplay } from '$lib/server/services';
import { bookorbitConfigured } from '$lib/server/books/bookorbit';
import { hardcoverConfigured } from '$lib/server/books/hardcover';
import type { PageServerLoad } from './$types';

/* Awaited rather than streamed. Preferences are a single small read and the
   whole page is controls bound to them — a skeleton here would flash for a few
   milliseconds and then be replaced, which is worse than waiting for it. */
export const load: PageServerLoad = async ({ locals, url }) => {
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
		// Offer the Books toggle only where there's something to show.
		booksAvailable: bookorbitConfigured() || hardcoverConfigured(),
		account: {
			me,
			mail: mailConfigured(),
			household: {
				name: householdName(me.householdId),
				members: listMembers(me.householdId),
				invites: me.role === 'owner' ? listPendingInvites(me.householdId) : []
			},
			linked: linkedStatus(me.id),
			bookorbit: bookorbitConfigured(),
			// Seek's own Jellyfin webhook (own-tracking plan, step 4): your private URL.
			jellyfin: {
				url: `${url.origin}/webhook/jellyfin/${jellyfinToken(me.id)}`,
				unmatched: recentUnmatched(me.id)
			}
		},
		// The household's service settings — owner only (keys never leave the server).
		services: me.role === 'owner' ? settingsForDisplay() : null,
		floppyReady: floppyConfigured()
	};
};
