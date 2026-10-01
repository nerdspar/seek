import { json, error } from '@sveltejs/kit';
import { getSeries, getMovie } from '$lib/server/arr';
import { serviceFor, requireConfigured, requireManage, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

/** The download summary for a title: the Sonarr series (monitored / quality /
 *  root / tags / seasons with file counts) or the Radarr movie (+ its file). Null
 *  when the title isn't in the relevant service — the page then shows nothing. */
export const GET: RequestHandler = async ({ url }) => {
	await requireManage();
	const mediaType = url.searchParams.get('mediaType') ?? 'tv';
	const tmdbId = url.searchParams.get('tmdbId');
	if (!tmdbId) error(400, 'tmdbId is required');

	const service = serviceFor(mediaType);
	requireConfigured(service);
	try {
		return json(
			service === 'radarr' ? { movie: await getMovie(tmdbId) } : { series: await getSeries(tmdbId) }
		);
	} catch (err) {
		arrFail(err, service);
	}
};
