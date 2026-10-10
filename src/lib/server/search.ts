/**
 * Search (§6.4): TMDB's own search, each result marked when it's already on
 * your list (Seek's `tracked` table). Server-only.
 */
import { db } from './db';
import { tmdb } from './tmdb';
import { currentUser } from './userctx';
import type { MediaType, SearchResult } from '$lib/types';

/** Every TMDB id on your list for a type. Microseconds: no cache needed. */
export async function allTrackedIds(mediaType: MediaType): Promise<Set<string>> {
	const me = currentUser();
	if (!me) return new Set();
	const kind = mediaType === 'movie' ? 'movie' : 'tv';
	return new Set(
		(db().prepare('SELECT tmdb_id FROM tracked WHERE user_id = ? AND media_type = ?').all(me.id, kind) as { tmdb_id: number }[]).map((r) =>
			String(r.tmdb_id)
		)
	);
}

type TmdbSearch = {
	results?: { id: number; name?: string; title?: string; poster_path?: string | null; first_air_date?: string; release_date?: string }[];
};

async function searchOne(mediaType: MediaType, query: string, limit: number): Promise<SearchResult[]> {
	const kind = mediaType === 'movie' ? 'movie' : 'tv';
	const [res, tracked] = await Promise.all([tmdb<TmdbSearch>(`/search/${kind}`, { query, include_adult: 'false' }), allTrackedIds(kind)]);
	return (res.results ?? []).slice(0, limit).map((r): SearchResult => {
		const mediaId = String(r.id);
		const date = r.first_air_date || r.release_date || '';
		return {
			mediaId,
			source: 'tmdb',
			mediaType: kind,
			title: r.name || r.title || 'Untitled',
			poster: r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null,
			year: date.length >= 4 ? Number(date.slice(0, 4)) : null,
			tracked: tracked.has(mediaId)
		};
	});
}

export type SearchScope = 'best' | 'tv' | 'movie';

/** Anime is deliberately not a scope: on TMDB it's TV, so an Anime chip would
 *  return exactly the TV rows. */
export async function search(scope: SearchScope, query: string, limit = 20): Promise<SearchResult[]> {
	const q = query.trim();
	if (!q) return [];

	if (scope !== 'best') return searchOne(scope, q, limit);

	// Best match: both types, interleaved so neither buries the other.
	const [tv, movie] = await Promise.all([
		searchOne('tv', q, Math.ceil(limit / 2)),
		searchOne('movie', q, Math.ceil(limit / 2))
	]);

	const merged: SearchResult[] = [];
	for (let i = 0; i < Math.max(tv.length, movie.length); i++) {
		if (tv[i]) merged.push(tv[i]);
		if (movie[i]) merged.push(movie[i]);
	}
	return merged.slice(0, limit);
}

/**
 * Drop anything already in the library from a list of suggestions.
 *
 * Browsing surfaces — moods, a service's trending row, the universal search —
 * are for finding something new. A title you already track is not a find, and
 * its add button would do nothing. The Search *tab* is
 * deliberately excluded: there you are checking whether you already have a
 * specific thing, so it marks rather than hides.
 */
export async function withoutTracked<T extends { mediaId: string }>(
	mediaType: MediaType,
	items: T[]
): Promise<T[]> {
	const tracked = await allTrackedIds(mediaType);
	return items.filter((i) => !tracked.has(i.mediaId));
}

/**
 * Flag what is already in the library instead of hiding it.
 *
 * For a filmography, hiding is wrong: a show you have already watched is
 * exactly what you might be hunting for, and nothing else in the app can find
 * one by actor — Search is title-only and the library browses by title. So a
 * person's credits keep everything and tick what you have.
 */
export async function markTracked<T extends { mediaId: string }>(
	mediaType: MediaType,
	items: T[]
): Promise<(T & { tracked: boolean })[]> {
	const tracked = await allTrackedIds(mediaType);
	return items.map((i) => ({ ...i, tracked: tracked.has(i.mediaId) }));
}
