import { json } from '@sveltejs/kit';
import { getOptions } from '$lib/server/arr';
import { getPrefs } from '$lib/server/prefs';
import type { RequestHandler } from './$types';

/** Root folders, quality profiles and tags for each service, plus the saved
 *  add defaults — everything the Settings picker and the add sheet need. Never
 *  fails: an unconfigured or unreachable service reports itself so the UI can
 *  render the right empty state. */
export const GET: RequestHandler = async () => {
	const [sonarr, radarr, prefs] = await Promise.all([
		getOptions('sonarr'),
		getOptions('radarr'),
		getPrefs()
	]);
	return json({
		sonarr: { ...sonarr, default: prefs.sonarr },
		radarr: { ...radarr, default: prefs.radarr }
	});
};
