/**
 * Next-up from Seek's own data (own-tracking plan, step 3): your plays plus the
 * show's episode list. Same rules Seek applies to Floppy today, without the
 * corrections — there's nothing stale to correct:
 *
 * - nothing watched yet → the first aired episode of the first season;
 * - otherwise, in the season you most recently played, the first aired,
 *   unwatched episode after the highest one you've played (an episode skipped
 *   mid-season is a choice, not a bookmark);
 * - that season finished → the first aired episode of the next season you
 *   haven't started; none → caught up.
 *
 * Specials (season 0) never count. An episode has aired once its air time has
 * passed, or — with only a date — from 00:00 UTC on that date.
 */

export type Ep = { season: number; episode: number; airDate: string | null; airAt: string | null };
export type Played = { season: number; episode: number; watchedAt: string };
export type NextUp = { season: number; episode: number } | 'caught-up' | null;

export function aired(e: Pick<Ep, 'airDate' | 'airAt'>, now: number): boolean {
	const at = e.airAt ? Date.parse(e.airAt) : e.airDate ? Date.parse(`${e.airDate}T00:00:00Z`) : NaN;
	return Number.isFinite(at) && at <= now;
}

export function nextUp(episodes: Ep[], plays: Played[], now: number): NextUp {
	const regular = episodes.filter((e) => e.season > 0).sort((a, b) => a.season - b.season || a.episode - b.episode);
	const watched = new Set(plays.map((p) => `${p.season}:${p.episode}`));
	const isAired = (e: Ep) => aired(e, now);
	const unwatched = (e: Ep) => !watched.has(`${e.season}:${e.episode}`);
	const seasonPlays = plays.filter((p) => p.season > 0);

	if (!seasonPlays.length) {
		const first = regular.find((e) => isAired(e));
		return first ? { season: first.season, episode: first.episode } : null;
	}

	const latest = seasonPlays.reduce((a, b) => (Date.parse(b.watchedAt) > Date.parse(a.watchedAt) ? b : a));
	const current = latest.season;
	const highest = Math.max(...seasonPlays.filter((p) => p.season === current).map((p) => p.episode));
	const inSeason = regular.find((e) => e.season === current && e.episode > highest && unwatched(e) && isAired(e));
	if (inSeason) return { season: inSeason.season, episode: inSeason.episode };

	const started = new Set(seasonPlays.map((p) => p.season));
	const nextSeason = regular.find((e) => e.season > current && !started.has(e.season) && isAired(e));
	return nextSeason ? { season: nextSeason.season, episode: nextSeason.episode } : 'caught-up';
}
