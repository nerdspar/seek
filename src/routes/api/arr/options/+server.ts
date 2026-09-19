import { json } from '@sveltejs/kit';
import { getOptions } from '$lib/server/arr';
import type { RequestHandler } from './$types';

/** Root folders + quality profiles for each service, for the Settings picker.
 *  Never fails — an unconfigured or unreachable service reports itself so the
 *  UI can render the right empty state. */
export const GET: RequestHandler = async () => {
	const [sonarr, radarr] = await Promise.all([getOptions('sonarr'), getOptions('radarr')]);
	return json({ sonarr, radarr });
};
