import { redirect } from '@sveltejs/kit';
import { getDiscoverRows } from '$lib/server/discover';
import { memo } from '$lib/server/memo';
import { DEFAULT_PRESET_LABELS, getProviders, tmdbConfigured } from '$lib/server/tmdb';
import { getPrefs } from '$lib/server/prefs';
import { hardcoverConfigured } from '$lib/server/books/hardcover';
import { landing, mediaOn } from '$lib/media';
import { knownServices, normaliseService } from '$lib/server/watchlist';
import type { MediaType } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('type') as MediaType | null;

	/* Lets other pages hand Discover a search to run. Tapping a cast member is
	   the reason: an actor's name means nothing to Floppy's title search, and
	   the universal search here is the one thing that resolves people. */
	const query = (url.searchParams.get('q') ?? '').trim();

	/* Labels only — keyword ids stay server-side so the client never builds TMDB
	   queries itself. Null means the user has not customised them, so they get
	   whatever the current built-in list is. */
	const prefs = await getPrefs();
	const presets = prefs.moodPresets ?? DEFAULT_PRESET_LABELS();

	/* Shows / movies / books each switch off per person: land on one that's on —
	   book discovery when it's the only one. */
	const media = mediaOn(prefs, hardcoverConfigured());
	const kind = landing(requested === 'movie' ? 'movie' : requested === 'tv' ? 'tv' : null, media);
	if (kind === 'book') redirect(307, '/discover/books');
	const mediaType: MediaType = kind;

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
		// The Books segment: your setting, and Hardcover to discover from.
		books: media.book,
		media,
		mediaType,
		query,
		presets,
		platforms,
		moodAvailable: tmdbConfigured(),
		/* Streamed. Floppy builds these rows on its own schedule and they change
		   slowly, so a stale read is fine and a blocking rebuild is not — and the
		   movie side is not warmed at all. */
		rows: memo(`discover:${mediaType}`, 30 * 60 * 1000, () => getDiscoverRows(mediaType))
	};
};
