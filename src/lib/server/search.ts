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
		// A failed cross-reference must not fail the search; worst case a row
		// offers "Add" for something already tracked, which Floppy tolerates.
		return new Set();
	}
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
