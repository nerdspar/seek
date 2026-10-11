import { json } from '@sveltejs/kit';
import { genreList, getProviders, tmdbConfigured } from '$lib/server/tmdb';
import { knownServices, normaliseService } from '$lib/server/watchlist';
import { getPrefs } from '$lib/server/prefs';
import { memo } from '$lib/server/memo';
import type { MediaType } from '$lib/types';
import type { RequestHandler } from './$types';

/** The fixed facets for the Discover filter sheet: genres (for this type) and
 *  the streaming services to filter by — the ones you curated in Settings (in
 *  that order) when you've set any, otherwise every service your library uses. */
export const GET: RequestHandler = async ({ url }) => {
	if (!tmdbConfigured()) return json({ genres: [], services: [] });
	const mediaType: MediaType = url.searchParams.get('type') === 'movie' ? 'movie' : 'tv';
	const [genres, all, prefs] = await Promise.all([
		genreList(mediaType === 'movie' ? 'movie' : 'tv'),
		memo('discover:facet-services', 24 * 60 * 60 * 1000, async () => {
			const [providers, seen] = await Promise.all([getProviders(), knownServices()]);
			const wanted = new Set(seen.map((s) => normaliseService(s).toLowerCase()));
			return providers
				.filter((p) => wanted.has(normaliseService(p.name).toLowerCase()))
				.map((p) => ({ id: p.id, name: p.name }));
		}),
		getPrefs().catch(() => null)
	]);

	// Curated in Settings? Show only those, in the chosen order. Nothing curated
	// (empty = "all") falls back to every service the library uses.
	const curated = (prefs?.services ?? []).map((s) => normaliseService(s).toLowerCase());
	let services = all;
	if (curated.length) {
		const byName = new Map(all.map((p) => [normaliseService(p.name).toLowerCase(), p]));
		services = curated.map((c) => byName.get(c)).filter((p): p is { id: number; name: string } => Boolean(p));
	}
	return json({ genres, services });
};
