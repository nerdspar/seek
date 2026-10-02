import { json, error } from '@sveltejs/kit';
import { setSeasonsMonitored, setEpisodesMonitored } from '$lib/server/arr';
import { requireConfigured, requireManage, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

type Body = {
	tmdbId?: string | number;
	/** Sonarr season number(s) to flip (the real Sonarr seasons the Floppy season
	 *  maps to), and/or the matched episode ids. Both are usually sent together so
	 *  the season flag and its episodes stay consistent. */
	seasons?: number[];
	episodeIds?: number[];
	monitored?: boolean;
};

/** Monitor / unmonitor a season (its Sonarr season flag) and/or a set of episodes
 *  (Sonarr only — Radarr monitoring is the single movie flag, handled by /edit). */
export const PUT: RequestHandler = async ({ request }) => {
	await requireManage();
	const body = (await request.json().catch(() => ({}))) as Body;
	if (typeof body.monitored !== 'boolean') error(400, 'monitored is required');

	requireConfigured('sonarr');
	try {
		let did = false;
		if (Array.isArray(body.seasons) && body.seasons.length && body.tmdbId != null) {
			await setSeasonsMonitored(String(body.tmdbId), body.seasons, body.monitored);
			did = true;
		}
		if (Array.isArray(body.episodeIds) && body.episodeIds.length) {
			await setEpisodesMonitored(body.episodeIds, body.monitored);
			did = true;
		}
		if (!did) error(400, 'Provide tmdbId + seasons, and/or episodeIds');
		return json({ ok: true });
	} catch (err) {
		arrFail(err, 'sonarr');
	}
};
