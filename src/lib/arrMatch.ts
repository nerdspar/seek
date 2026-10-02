/**
 * Match a Floppy (TMDB-numbered) episode to its Sonarr (TVDB-numbered) episode.
 *
 * Floppy exposes no per-episode TVDB id, so these have to be lined up heuristically.
 * Episode *number* within a season is unreliable: for shows where TMDB and TVDB
 * disagree on season structure (The Great British Bake Off is the classic case —
 * TMDB "Season 1" is the 2017 10-episode run, TVDB "Season 1" is the 2010 6-episode
 * original), matching by number maps to the wrong episode or to nothing.
 *
 * Air date is far more robust: the same episode aired on the same day regardless of
 * how each database numbers its seasons. So we match on air date first (within a
 * window, to absorb timezone skew between Floppy's local datetime and Sonarr's UTC),
 * and fall back to (season, episode) number only when there's no usable date.
 */
import type { ArrEpisode } from './server/arr';

/** Timezone skew can shift a date by up to ~14h; weekly episodes are ~7 days apart,
 *  so a 20h window matches the same episode without colliding with its neighbours. */
const MATCH_WINDOW_MS = 20 * 60 * 60 * 1000;

export type FloppyEpisodeKey = {
	seasonNumber: number;
	episodeNumber: number;
	airDate: string | null;
};

const byNumber = (floppy: FloppyEpisodeKey, sonarr: ArrEpisode[]): ArrEpisode | null =>
	sonarr.find(
		(e) => e.seasonNumber === floppy.seasonNumber && e.episodeNumber === floppy.episodeNumber
	) ?? null;

export function matchEpisode(floppy: FloppyEpisodeKey, sonarr: ArrEpisode[]): ArrEpisode | null {
	if (floppy.airDate) {
		const t = Date.parse(floppy.airDate);
		if (!Number.isNaN(t)) {
			const within = sonarr.filter(
				(e) => e.airDateUtc && Math.abs(Date.parse(e.airDateUtc) - t) <= MATCH_WINDOW_MS
			);
			if (within.length === 1) return within[0];
			if (within.length > 1) {
				// A same-day release (a whole season dropped at once) puts every
				// episode on one date, so "nearest date" can't tell them apart.
				// Disambiguate by episode number, then fall back to nearest date.
				const exact = byNumber(floppy, within);
				if (exact) return exact;
				return [...within].sort(
					(a, b) =>
						Math.abs(Date.parse(a.airDateUtc!) - t) - Math.abs(Date.parse(b.airDateUtc!) - t) ||
						a.episodeNumber - b.episodeNumber
				)[0];
			}
		}
	}
	return byNumber(floppy, sonarr);
}
