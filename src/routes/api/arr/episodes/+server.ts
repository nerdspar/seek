import { json, error } from '@sveltejs/kit';
import { getSeries, getSeasonEpisodes, type ArrEpisode } from '$lib/server/arr';
import { getSeason } from '$lib/server/detail';
import { matchEpisode } from '$lib/arrMatch';
import { requireConfigured, requireManage, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

/**
 * Per-episode download state for one Floppy (TMDB) season, matched to Sonarr by
 * **air date** rather than episode number — so shows where TMDB and TVDB disagree
 * on season structure (e.g. The Great British Bake Off) line up correctly instead
 * of mapping to the wrong episode or to nothing.
 *
 * Matching is done here, where both Floppy's season and Sonarr's full episode list
 * are available: each returned episode carries the real Sonarr id / hasFile /
 * monitored / file, but is re-keyed to the Floppy episode number the client renders
 * by. `episodeIds` are the matched Sonarr ids, for season-level search/monitor.
 */
export const GET: RequestHandler = async ({ url }) => {
	await requireManage();
	const tmdbId = url.searchParams.get('tmdbId');
	const source = url.searchParams.get('source') ?? 'tmdb';
	const seasonRaw = url.searchParams.get('season');
	if (!tmdbId) error(400, 'tmdbId is required');
	if (seasonRaw === null) error(400, 'season is required');
	const season = Number(seasonRaw);
	if (!Number.isInteger(season)) error(400, 'season must be an integer');

	requireConfigured('sonarr');
	try {
		const series = await getSeries(tmdbId);
		if (!series) return json({ inLibrary: false, episodes: [] });

		// Fetch both halves concurrently: Sonarr's whole episode list (so the
		// air-date match can reach the episode wherever TVDB files it) and Floppy's
		// own season (for the air dates to match against).
		const [sonarrAll, floppySeason] = await Promise.all([
			getSeasonEpisodes(series.id),
			getSeason(source, tmdbId, season).catch(() => null)
		]);

		// If Floppy can't be read, fall back to the Sonarr episodes numbered under
		// this season.
		const floppyEps: { seasonNumber: number; episodeNumber: number; airDate: string | null }[] =
			floppySeason
				? floppySeason.episodes.map((e) => ({
						seasonNumber: e.seasonNumber,
						episodeNumber: e.episodeNumber,
						airDate: e.airDate
					}))
				: sonarrAll
						.filter((e) => e.seasonNumber === season)
						.map((e) => ({ seasonNumber: e.seasonNumber, episodeNumber: e.episodeNumber, airDate: e.airDateUtc }));

		const episodes: ArrEpisode[] = [];
		const episodeIds: number[] = [];
		const sonarrSeasonSet = new Set<number>();
		for (const fe of floppyEps) {
			const se = matchEpisode(fe, sonarrAll);
			if (!se) continue;
			sonarrSeasonSet.add(se.seasonNumber);
			// Re-key to the Floppy episode number the client lists by; keep the real
			// Sonarr id/hasFile/monitored/file for status and per-episode actions.
			episodes.push({ ...se, seasonNumber: fe.seasonNumber, episodeNumber: fe.episodeNumber });
			episodeIds.push(se.id);
		}

		// Monitored reflects the Sonarr *season* flag(s) of the season(s) these
		// episodes actually live in (a renumbered show maps a Floppy season to a
		// different Sonarr season) — not "every episode monitored", since a season
		// can be monitored while its downloaded episodes are individually not.
		const sonarrSeasons = [...sonarrSeasonSet];
		const seasonMonitored = sonarrSeasons.length
			? sonarrSeasons.every((sn) => series.seasons.find((s) => s.seasonNumber === sn)?.monitored ?? false)
			: null;

		return json({ inLibrary: true, seriesId: series.id, seasonMonitored, sonarrSeasons, episodeIds, episodes });
	} catch (err) {
		arrFail(err, 'sonarr');
	}
};
