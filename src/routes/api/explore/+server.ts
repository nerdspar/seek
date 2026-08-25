import { json, error } from '@sveltejs/kit';
import { explore } from '$lib/server/explore';
import { tmdbConfigured } from '$lib/server/tmdb';
import type { RequestHandler } from './$types';

/** One box, every interpretation (§6.2). */
export const GET: RequestHandler = async ({ url }) => {
	if (!tmdbConfigured()) error(503, 'TMDB_API_KEY is not set — search is unavailable.');

	const q = url.searchParams.get('q')?.trim() ?? '';
	const mediaType = url.searchParams.get('type') === 'movie' ? 'movie' : 'tv';
	if (!q) return json({ sections: [] });

	try {
		return json({ sections: await explore(q, mediaType) });
	} catch (err) {
		error(502, err instanceof Error ? err.message : 'Search failed.');
	}
};
