import { getDiscoverRows } from '$lib/server/discover';
import { memo } from '$lib/server/memo';
import { DEFAULT_PRESET_LABELS, tmdbConfigured } from '$lib/server/tmdb';
import { getPrefs } from '$lib/server/prefs';
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

	return {
		mediaType,
		presets,
		moodAvailable: tmdbConfigured(),
		/* Streamed. Floppy builds these rows on its own schedule and they change
		   slowly, so a stale read is fine and a blocking rebuild is not — and the
		   movie side is not warmed at all. */
		rows: memo(`discover:${mediaType}`, 30 * 60 * 1000, () => getDiscoverRows(mediaType))
	};
};
