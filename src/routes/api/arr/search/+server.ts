import { json, error } from '@sveltejs/kit';
import { getSeries, getMovie, runSearch } from '$lib/server/arr';
import { serviceFor, requireConfigured, requireManage, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

type Body = {
	mediaType?: string;
	tmdbId?: string | number;
	kind?: 'series' | 'season' | 'episodes' | 'movie';
	season?: number;
	episodeIds?: number[];
	/** Radarr movie id directly (history retry / wanted), instead of a tmdb lookup. */
	movieId?: number;
};

/** Fire an automatic search. Series/season/movie resolve the Sonarr/Radarr id
 *  from the TMDB id here; an episode search is given the episode ids directly. */
export const POST: RequestHandler = async ({ request }) => {
	await requireManage();
	const body = (await request.json().catch(() => ({}))) as Body;
	const tmdbId = body.tmdbId != null ? String(body.tmdbId) : '';
	const service = serviceFor(body.mediaType);
	requireConfigured(service);

	try {
		if (body.kind === 'episodes') {
			if (!Array.isArray(body.episodeIds) || !body.episodeIds.length) error(400, 'episodeIds required');
			await runSearch({ kind: 'episodes', episodeIds: body.episodeIds });
			return json({ ok: true });
		}
		if (body.kind === 'movie') {
			let movieId = body.movieId;
			if (movieId == null) {
				if (!tmdbId) error(400, 'tmdbId or movieId required');
				const movie = await getMovie(tmdbId);
				if (!movie) error(404, 'Not in Radarr');
				movieId = movie.id;
			}
			await runSearch({ kind: 'movie', movieId });
			return json({ ok: true });
		}
		// series or season
		if (!tmdbId) error(400, 'tmdbId required');
		const series = await getSeries(tmdbId);
		if (!series) error(404, 'Not in Sonarr');
		if (body.kind === 'season') {
			if (typeof body.season !== 'number') error(400, 'season required');
			await runSearch({ kind: 'season', seriesId: series.id, seasonNumber: body.season });
		} else {
			await runSearch({ kind: 'series', seriesId: series.id });
		}
		return json({ ok: true });
	} catch (err) {
		arrFail(err, service);
	}
};
