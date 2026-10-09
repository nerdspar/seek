/** Where Seek's show and movie info comes from: TMDB (details, episodes) and
 *  TVmaze (real air times; free, no key, ~20 requests per 10 seconds). */
import { tmdb } from '../tmdb';
import type { TvmazeEpisode } from './map';

export const tmdbShow = (id: number) =>
	tmdb<Record<string, unknown>>(`/tv/${id}`, { append_to_response: 'external_ids,watch/providers,keywords,aggregate_credits,content_ratings' });
export const tmdbSeason = (id: number, season: number) =>
	tmdb<Record<string, unknown>>(`/tv/${id}/season/${season}`);
export const tmdbMovie = (id: number) =>
	tmdb<Record<string, unknown>>(`/movie/${id}`, { append_to_response: 'external_ids,watch/providers,keywords,credits,release_dates' });

const MAZE = 'https://api.tvmaze.com';
let lastMaze = 0;

/** One TVmaze call, spaced to stay well under its limit. Null on 404. */
async function maze<T>(path: string): Promise<T | null> {
	const wait = lastMaze + 600 - Date.now();
	if (wait > 0) await new Promise((r) => setTimeout(r, wait));
	lastMaze = Date.now();
	const res = await fetch(`${MAZE}${path}`, { signal: AbortSignal.timeout(15_000) });
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`TVmaze ${path} → ${res.status}`);
	return res.json() as Promise<T>;
}

/** A show's TVmaze id, looked up by TVDB id, else IMDb id. */
export async function tvmazeId(tvdbId: number | null, imdbId: string | null): Promise<number | null> {
	for (const q of [tvdbId ? `thetvdb=${tvdbId}` : null, imdbId ? `imdb=${encodeURIComponent(imdbId)}` : null]) {
		if (!q) continue;
		const show = await maze<{ id?: number }>(`/lookup/shows?${q}`);
		if (typeof show?.id === 'number') return show.id;
	}
	return null;
}

/** A show's episodes on TVmaze, with their air instants. */
export async function tvmazeEpisodes(id: number): Promise<TvmazeEpisode[]> {
	const eps = (await maze<Record<string, unknown>[]>(`/shows/${id}/episodes`)) ?? [];
	return eps
		.filter((e) => typeof e.season === 'number' && typeof e.number === 'number')
		.map((e) => ({
			season: e.season as number,
			number: e.number as number,
			airdate: typeof e.airdate === 'string' && e.airdate ? e.airdate : null,
			// No airtime means no real time: streaming drops get a placeholder
			// airstamp of noon UTC, which would be worse than a plain date.
			airstamp: typeof e.airstamp === 'string' && e.airstamp && typeof e.airtime === 'string' && e.airtime ? e.airstamp : null
		}));
}
