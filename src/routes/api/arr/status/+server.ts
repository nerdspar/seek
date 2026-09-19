import { json } from '@sveltejs/kit';
import { libraryStatus, sonarrConfigured, radarrConfigured } from '$lib/server/arr';
import type { RequestHandler } from './$types';

/** tmdbIds already in Sonarr/Radarr, so browse rows can show a tick instead of
 *  an add button. Also reports which services exist at all, so the client knows
 *  whether to render the affordance. */
export const GET: RequestHandler = async () => {
	const status = await libraryStatus();
	return json({
		sonarr: { configured: sonarrConfigured(), ids: status.sonarr },
		radarr: { configured: radarrConfigured(), ids: status.radarr }
	});
};
