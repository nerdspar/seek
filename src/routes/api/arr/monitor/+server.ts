import { json, error } from '@sveltejs/kit';
import { setSeasonMonitored, setEpisodesMonitored } from '$lib/server/arr';
import { requireConfigured, requireManage, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

type Body = {
	tmdbId?: string | number;
	/** A whole season (needs tmdbId) … */
	season?: number;
	/** … or specific Sonarr episode ids. */
	episodeIds?: number[];
	monitored?: boolean;
};

/** Monitor / unmonitor a season or a set of episodes (Sonarr only — Radarr
 *  monitoring is the single movie flag, handled by /edit). */
export const PUT: RequestHandler = async ({ request }) => {
	await requireManage();
	const body = (await request.json().catch(() => ({}))) as Body;
	if (typeof body.monitored !== 'boolean') error(400, 'monitored is required');

	requireConfigured('sonarr');
	try {
		if (Array.isArray(body.episodeIds) && body.episodeIds.length) {
			await setEpisodesMonitored(body.episodeIds, body.monitored);
		} else if (typeof body.season === 'number' && body.tmdbId != null) {
			await setSeasonMonitored(String(body.tmdbId), body.season, body.monitored);
		} else {
			error(400, 'Provide episodeIds, or tmdbId + season');
		}
		return json({ ok: true });
	} catch (err) {
		arrFail(err, 'sonarr');
	}
};
