import { json, error } from '@sveltejs/kit';
import { getSeries, getMovie, getReleases } from '$lib/server/arr';
import { serviceFor, requireConfigured, requireManage, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

/** Interactive-search candidates. Slow (hits indexers), so the client shows a
 *  spinner. For an episode the client passes episodeId directly; a season or
 *  movie resolves its id from the TMDB id here. */
export const GET: RequestHandler = async ({ url }) => {
	await requireManage();
	const mediaType = url.searchParams.get('mediaType') ?? 'tv';
	const tmdbId = url.searchParams.get('tmdbId');
	const episodeIdRaw = url.searchParams.get('episodeId');
	const seasonRaw = url.searchParams.get('season');
	const service = serviceFor(mediaType);
	requireConfigured(service);

	try {
		if (service === 'radarr') {
			if (!tmdbId) error(400, 'tmdbId required');
			const movie = await getMovie(tmdbId);
			if (!movie) error(404, 'Not in Radarr');
			return json({ releases: await getReleases({ service: 'radarr', movieId: movie.id }) });
		}
		if (episodeIdRaw !== null) {
			const episodeId = Number(episodeIdRaw);
			if (!Number.isInteger(episodeId)) error(400, 'episodeId must be an integer');
			return json({ releases: await getReleases({ service: 'sonarr', episodeId }) });
		}
		if (seasonRaw !== null && tmdbId) {
			const season = Number(seasonRaw);
			if (!Number.isInteger(season)) error(400, 'season must be an integer');
			const series = await getSeries(tmdbId);
			if (!series) error(404, 'Not in Sonarr');
			return json({ releases: await getReleases({ service: 'sonarr', seriesId: series.id, seasonNumber: season }) });
		}
		error(400, 'Provide episodeId, or tmdbId + season (tv), or tmdbId (movie)');
	} catch (err) {
		arrFail(err, service);
	}
};
