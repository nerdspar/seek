import { json } from '@sveltejs/kit';
import { getHealth, sonarrConfigured, radarrConfigured } from '$lib/server/arr';
import { requireManage } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

/** Sonarr/Radarr health warnings (indexer down, disk space, removed series, …),
 *  merged across both configured services for the Activity banner. One service
 *  being down just contributes nothing rather than failing the call. */
export const GET: RequestHandler = async () => {
	await requireManage();
	const [sonarr, radarr] = await Promise.all([
		sonarrConfigured() ? getHealth('sonarr').catch(() => []) : Promise.resolve([]),
		radarrConfigured() ? getHealth('radarr').catch(() => []) : Promise.resolve([])
	]);
	return json({ issues: [...sonarr, ...radarr] });
};
