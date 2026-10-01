import { json, error } from '@sveltejs/kit';
import { getSeries, getSeasonEpisodes } from '$lib/server/arr';
import { requireConfigured, requireManage, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

/** Per-episode download state for one Sonarr season, so the season page can merge
 *  it onto Floppy's episode rows by (season, episode) number. `inLibrary` is
 *  false when the show isn't in Sonarr at all, so the page can stay quiet. */
export const GET: RequestHandler = async ({ url }) => {
	await requireManage();
	const tmdbId = url.searchParams.get('tmdbId');
	const seasonRaw = url.searchParams.get('season');
	if (!tmdbId) error(400, 'tmdbId is required');
	if (seasonRaw === null) error(400, 'season is required');
	const season = Number(seasonRaw);
	if (!Number.isInteger(season)) error(400, 'season must be an integer');

	requireConfigured('sonarr');
	try {
		const series = await getSeries(tmdbId);
		if (!series) return json({ inLibrary: false, episodes: [] });
		const episodes = await getSeasonEpisodes(series.id, season);
		return json({ inLibrary: true, seriesId: series.id, episodes });
	} catch (err) {
		arrFail(err, 'sonarr');
	}
};
