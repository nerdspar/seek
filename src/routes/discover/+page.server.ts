import { getDiscoverRows } from '$lib/server/discover';
import { memo } from '$lib/server/memo';
import { DEFAULT_PRESET_LABELS, getProviders, tmdbConfigured } from '$lib/server/tmdb';
import { getPrefs } from '$lib/server/prefs';
import { knownServices, normaliseService } from '$lib/server/watchlist';
import type { MediaType } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('type') as MediaType | null;
	const mediaType: MediaType = requested === 'movie' ? 'movie' : 'tv';

	/* Labels only — keyword ids stay server-side so the client never builds TMDB
	   queries itself. Null means the user has not customised them, so they get
	   whatever the current built-in list is. */
	const prefs = await getPrefs();
	const presets = prefs.moodPresets ?? DEFAULT_PRESET_LABELS();

	/* Offer only services the library actually has, matched to TMDB provider ids.
	   TMDB's raw list is mostly rental storefronts and obscure channels, and a
	   chip for a service you have never seen a title on is noise. Subscribed
	   services (§8) come first. */
	const platforms = memo('platforms:us', 24 * 60 * 60 * 1000, async () => {
		const [providers, seen] = await Promise.all([getProviders(), knownServices()]);
		const wanted = new Set(seen.map((s) => normaliseService(s).toLowerCase()));
		const matched = providers.filter((p) => wanted.has(normaliseService(p.name).toLowerCase()));

		const subscribed = new Set(prefs.services.map((s) => normaliseService(s).toLowerCase()));
		return matched.sort((a, b) => {
			const aSub = subscribed.has(normaliseService(a.name).toLowerCase()) ? 0 : 1;
			const bSub = subscribed.has(normaliseService(b.name).toLowerCase()) ? 0 : 1;
			return aSub - bSub;
		});
	});

	return {
		mediaType,
		presets,
		platforms,
		moodAvailable: tmdbConfigured(),
		/* Streamed. Floppy builds these rows on its own schedule and they change
		   slowly, so a stale read is fine and a blocking rebuild is not — and the
		   movie side is not warmed at all. */
		rows: memo(`discover:${mediaType}`, 30 * 60 * 1000, () => getDiscoverRows(mediaType))
	};
};
