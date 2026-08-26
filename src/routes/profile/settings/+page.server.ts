import { getPrefs } from '$lib/server/prefs';
import { FLOPPY_PUBLIC_URL } from '$lib/server/env';
import { DEFAULT_PRESET_LABELS } from '$lib/server/tmdb';
import type { PageServerLoad } from './$types';

/* Awaited rather than streamed. Preferences are a single small file read and the
   whole page is controls bound to them — a skeleton here would flash for a few
   milliseconds and then be replaced, which is worse than waiting for it. */
export const load: PageServerLoad = async () => {
	const publicUrl = FLOPPY_PUBLIC_URL();
	return {
		prefs: await getPrefs(),
		defaultPresets: DEFAULT_PRESET_LABELS(),
		/* Verified against the running instance: Floppy has no bare /settings/
		   route and its settings paths carry no trailing slash, so `/settings/`
		   404s. Lands on notifications because that is what this row points at. */
		floppyUrl: publicUrl ? `${publicUrl}/settings/notifications` : null
	};
};
