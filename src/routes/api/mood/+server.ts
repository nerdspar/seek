import { json, error } from '@sveltejs/kit';
import { discoverByKeyword, keywordIds, MOOD_PRESETS, tmdbConfigured } from '$lib/server/tmdb';
import type { RequestHandler } from './$types';

/** Mood and theme search (§6.2). Chips carry keyword ids; free text resolves
 *  through /search/keyword first. */
export const GET: RequestHandler = async ({ url }) => {
	if (!tmdbConfigured()) error(503, 'TMDB_API_KEY is not set — mood search is unavailable.');

	const mediaType = url.searchParams.get('type') === 'movie' ? 'movie' : 'tv';
	const preset = url.searchParams.get('preset');
	const q = url.searchParams.get('q')?.trim() ?? '';
	const minRating = Number(url.searchParams.get('minRating')) || undefined;

	try {
		const keywords = preset
			? (MOOD_PRESETS.find((p) => p.label === preset)?.keywords ?? [])
			: await keywordIds(q);

		if (!keywords.length) return json({ results: [], keywords: [] });

		return json({
			results: await discoverByKeyword({ keywords, mediaType, minRating }),
			keywords
		});
	} catch (err) {
		error(502, err instanceof Error ? err.message : 'Mood search failed.');
	}
};
