import { json } from '@sveltejs/kit';
import { libraryStatus, sonarrConfigured, radarrConfigured } from '$lib/server/arr';
import { getPrefs } from '$lib/server/prefs';
import type { RequestHandler } from './$types';

/** tmdbIds already in Sonarr/Radarr, so browse rows can show a tick instead of
 *  an add button. Also reports which services exist at all (so the client knows
 *  whether to render the affordance) and whether the download-management layer is
 *  switched on in Settings. `manage` is the single gate the client reads: it is
 *  true only when at least one service is configured *and* the preference is on. */
export const GET: RequestHandler = async () => {
	const [status, prefs] = await Promise.all([libraryStatus(), getPrefs()]);
	const anyConfigured = sonarrConfigured() || radarrConfigured();
	return json({
		sonarr: { configured: sonarrConfigured(), ids: status.sonarr },
		radarr: { configured: radarrConfigured(), ids: status.radarr },
		manage: anyConfigured && prefs.arrManage !== false
	});
};
