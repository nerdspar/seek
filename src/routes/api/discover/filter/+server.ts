import { json, error } from '@sveltejs/kit';
import { tmdbConfigured, tmdbDiscoverPage, type DiscoverSort } from '$lib/server/tmdb';
import { markTracked } from '$lib/server/search';
import type { MediaType } from '$lib/types';
import type { RequestHandler } from './$types';

const ids = (v: string | null) =>
	(v ?? '')
		.split(',')
		.map((x) => Number(x))
		.filter((n) => Number.isInteger(n) && n > 0);
const SORTS = new Set(['recommended', 'top', 'newest']);

/**
 * The Discover filter results: a page of titles matching the chosen facets,
 * with the total count for "Show N results", and what you already track marked.
 */
export const GET: RequestHandler = async ({ url }) => {
	if (!tmdbConfigured()) error(503, 'TMDB is not set up.');
	const q = url.searchParams;
	const mediaType: MediaType = q.get('type') === 'movie' ? 'movie' : 'tv';
	const kind = mediaType === 'movie' ? 'movie' : 'tv';
	const rawSort = q.get('sort') ?? 'recommended';
	const sort = (SORTS.has(rawSort) ? rawSort : 'recommended') as DiscoverSort;
	const yearGte = Number(q.get('yearGte')) || undefined;
	const yearLte = Number(q.get('yearLte')) || undefined;
	const page = Math.max(1, Math.min(5, Number(q.get('page')) || 1));

	const { results, total } = await tmdbDiscoverPage({
		mediaType: kind,
		genres: ids(q.get('genres')),
		keywords: ids(q.get('keywords')),
		people: ids(q.get('people')),
		providers: ids(q.get('providers')),
		yearGte,
		yearLte,
		sort,
		minVotes: sort === 'top' ? (kind === 'tv' ? 500 : 300) : 20,
		excludeNoise: true,
		page
	});
	return json({ total, results: await markTracked(kind, results) });
};
