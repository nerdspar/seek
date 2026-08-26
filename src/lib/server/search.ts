/**
 * Provider search and adding to the library (§6.4). Server-only.
 *
 * `GET /api/v1/search/{media_type}/` searches the PROVIDER, not the local
 * library, and its results carry no indication of whether something is already
 * tracked — the shape is just
 * `{media_id, source, media_type, title, original_title, localized_title, image, year}`.
 *
 * Showing "Add" next to a show the user already has would be a bug, so each
 * search is paired with one local list query using the same term, and results
 * are matched on media_id. That is one extra call per search, not one per row.
 */
import { floppy } from './floppy';
import { memo } from './memo';
import { getWatchlist } from './watchlist';
import type { MediaType, SearchResult } from '$lib/types';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});

type SearchResponse = { pagination?: { total: number }; results?: Rec[] };
type ListResponse = { results?: { item?: Rec }[] };

/** media_ids already in the library for this type, narrowed by the same query. */
async function trackedIds(mediaType: MediaType, query: string): Promise<Set<string>> {
	try {
		const res = await floppy<ListResponse>(`/api/v1/media/${mediaType}/`, {
			query: { status: ['all'], search: query, limit: 100 }
		});
		return new Set(
			(res.results ?? [])
				.map((r) => String(rec(r.item).media_id ?? ''))
				.filter(Boolean)
		);
	} catch {
		/* A failed cross-reference must not fail the search. Worst case a row
		   offers "Add" for something already tracked — which the add route now
		   treats as success, so the user still ends up in the right place. */
		return new Set();
	}
}

/**
 * Every tracked media_id for a type, for surfaces with no search term to narrow
 * by — Discover in particular, whose rows are recommendations that can perfectly
 * well include something already in the library.
 *
 * Reuses the collection view's cache key, which the boot warmup already fills,
 * so this is normally free rather than another full pass over the library.
 */
export function allTrackedIds(mediaType: MediaType): Promise<Set<string>> {
	return memo(`tracked:${mediaType}`, 5 * 60 * 1000, async () => {
		try {
			const page = await getWatchlist(mediaType, {
				statuses: ['all'],
				sort: 'title',
				direction: 'asc',
				all: true,
				enrich: false
			});
			return new Set(page.rows.map((r) => r.mediaId).filter(Boolean));
		} catch {
			return new Set<string>();
		}
	});
}

async function searchOne(mediaType: MediaType, query: string, limit: number): Promise<SearchResult[]> {
	const [res, tracked] = await Promise.all([
		floppy<SearchResponse>(`/api/v1/search/${mediaType}/`, {
			query: { search: query, source: 'tmdb', limit }
		}),
		trackedIds(mediaType, query)
	]);

	return (res.results ?? []).map((r): SearchResult => {
		const mediaId = String(r.media_id ?? '');
		return {
			mediaId,
			source: String(r.source ?? 'tmdb'),
			mediaType,
			title: String(r.title ?? 'Untitled'),
			poster: typeof r.image === 'string' && r.image ? r.image : null,
			year: typeof r.year === 'number' ? r.year : null,
			tracked: tracked.has(mediaId)
		};
	});
}

export type SearchScope = 'best' | 'tv' | 'movie';

/**
 * Anime is deliberately not a scope. Floppy resolves an anime+tmdb search to
 * `tmdb.search(tv)` and relabels the results, so an Anime chip returns exactly
 * the same rows as TV Shows — a filter that appears to narrow and does not.
 */
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
 * Start tracking. Verified minimal body: `{source, media_id}` returns 201 with
 * status 0 (Planning), which is what "add to library" should mean — §3 notes an
 * omitted status defaults to Planning.
 */
export function addMedia(mediaType: MediaType, source: string, mediaId: string) {
	return floppy(`/api/v1/media/${mediaType}/`, {
		method: 'POST',
		body: { source, media_id: mediaId }
	});
}

/** Untrack — used to reverse an accidental add. */
export function removeMedia(mediaType: MediaType, source: string, mediaId: string) {
	return floppy(`/api/v1/media/${mediaType}/${source}/${encodeURIComponent(mediaId)}/`, {
		method: 'DELETE'
	});
}

/**
 * Drop anything already in the library from a list of suggestions.
 *
 * Browsing surfaces — moods, a service's trending row, the universal search —
 * are for finding something new. A title you already track is not a find, and
 * its add button would only earn a 409 from Floppy. The Search *tab* is
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
