import { json, error } from '@sveltejs/kit';
import { getWanted, searchAllMissing, sonarrConfigured, radarrConfigured } from '$lib/server/arr';
import { requireManage, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

/** Monitored-but-missing (or cutoff-unmet) across both services. */
export const GET: RequestHandler = async ({ url }) => {
	await requireManage();
	const kind = url.searchParams.get('kind') === 'cutoff' ? 'cutoff' : 'missing';
	const [sonarr, radarr] = await Promise.all([
		sonarrConfigured() ? getWanted('sonarr', kind).catch(() => []) : Promise.resolve([]),
		radarrConfigured() ? getWanted('radarr', kind).catch(() => []) : Promise.resolve([])
	]);
	return json({ sonarr, radarr });
};

/** "Search all": kick off a missing-item search on the configured services. */
export const POST: RequestHandler = async () => {
	await requireManage();
	try {
		await Promise.all([
			sonarrConfigured() ? searchAllMissing('sonarr') : Promise.resolve(),
			radarrConfigured() ? searchAllMissing('radarr') : Promise.resolve()
		]);
		return json({ ok: true });
	} catch (err) {
		arrFail(err, sonarrConfigured() ? 'sonarr' : 'radarr');
	}
};
