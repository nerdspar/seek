import { withoutTracked } from '$lib/server/search';
import { json, error } from '@sveltejs/kit';
import {
	discoverByKeyword,
	keywordIds,
	keywordsForLabel,
	tmdbConfigured,
	type DiscoverSort
} from '$lib/server/tmdb';
import type { RequestHandler } from './$types';

const SORTS: DiscoverSort[] = ['recommended', 'newest', 'top'];

/** Mood and theme search (§6.2). Chips carry keyword ids; free text resolves
 *  through /search/keyword first. */
export const GET: RequestHandler = async ({ url }) => {
	if (!tmdbConfigured()) error(503, 'TMDB_API_KEY is not set — mood search is unavailable.');

	const mediaType = url.searchParams.get('type') === 'movie' ? 'movie' : 'tv';
	const preset = url.searchParams.get('preset');
	const q = url.searchParams.get('q')?.trim() ?? '';
	const minRating = Number(url.searchParams.get('minRating')) || undefined;
	const sortParam = url.searchParams.get('sort');
	const sort = SORTS.includes(sortParam as DiscoverSort) ? (sortParam as DiscoverSort) : 'recommended';

	try {
		/* A chip and free text resolve the same way. Built-in labels carry curated
		   id sets — "heist" alone misses "bank heist" and "art heist" — and a label
		   the user added falls through to TMDB's keyword search. */
		const keywords = preset
			? (keywordsForLabel(preset) ?? (await keywordIds(preset)))
			: await keywordIds(q);

		if (!keywords.length) return json({ results: [], keywords: [] });

		return json({
			results: await withoutTracked(
				mediaType,
				await discoverByKeyword({ keywords, mediaType, minRating, sort })
			),
			keywords
		});
	} catch (err) {
		error(502, err instanceof Error ? err.message : 'Mood search failed.');
	}
};
