import { json } from '@sveltejs/kit';
import { genreList, getProviders, tmdbConfigured } from '$lib/server/tmdb';
import { knownServices, normaliseService } from '$lib/server/watchlist';
import { memo } from '$lib/server/memo';
import type { MediaType } from '$lib/types';
import type { RequestHandler } from './$types';

/** The fixed facets for the Discover filter sheet: genres (for this type) and
 *  the streaming services your library actually uses, matched to TMDB ids. */
export const GET: RequestHandler = async ({ url }) => {
	if (!tmdbConfigured()) return json({ genres: [], services: [] });
	const mediaType: MediaType = url.searchParams.get('type') === 'movie' ? 'movie' : 'tv';
	const [genres, services] = await Promise.all([
		genreList(mediaType === 'movie' ? 'movie' : 'tv'),
		memo('discover:facet-services', 24 * 60 * 60 * 1000, async () => {
			const [providers, seen] = await Promise.all([getProviders(), knownServices()]);
			const wanted = new Set(seen.map((s) => normaliseService(s).toLowerCase()));
			return providers
				.filter((p) => wanted.has(normaliseService(p.name).toLowerCase()))
				.map((p) => ({ id: p.id, name: p.name }));
		})
	]);
	return json({ genres, services });
};
