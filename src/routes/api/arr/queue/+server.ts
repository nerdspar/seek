import { json } from '@sveltejs/kit';
import { getQueue, sonarrConfigured, radarrConfigured } from '$lib/server/arr';
import { requireManage } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

/** What's downloading now, across both services. Each configured service is
 *  queried independently; one being down just yields an empty list for it rather
 *  than failing the whole call, so a partial stack still shows progress. */
export const GET: RequestHandler = async () => {
	await requireManage();
	const [sonarr, radarr] = await Promise.all([
		sonarrConfigured() ? getQueue('sonarr').catch(() => []) : Promise.resolve([]),
		radarrConfigured() ? getQueue('radarr').catch(() => []) : Promise.resolve([])
	]);
	return json({ sonarr, radarr });
};
