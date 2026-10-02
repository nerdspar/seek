import { json } from '@sveltejs/kit';
import { getHistory, sonarrConfigured, radarrConfigured } from '$lib/server/arr';
import { requireManage } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

/** Recent history across both services. Each is fetched independently so one
 *  being down just yields an empty list for it; the client merges and sorts by
 *  date. */
export const GET: RequestHandler = async ({ url }) => {
	await requireManage();
	const page = Number(url.searchParams.get('page') ?? '1') || 1;
	const [sonarr, radarr] = await Promise.all([
		sonarrConfigured() ? getHistory('sonarr', page).catch(() => []) : Promise.resolve([]),
		radarrConfigured() ? getHistory('radarr', page).catch(() => []) : Promise.resolve([])
	]);
	return json({ sonarr, radarr });
};
