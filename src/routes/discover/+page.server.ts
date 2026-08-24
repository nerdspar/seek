import { getDiscoverRows } from '$lib/server/discover';
import { MOOD_PRESETS, tmdbConfigured } from '$lib/server/tmdb';
import type { MediaType } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('type') as MediaType | null;
	const mediaType: MediaType = requested === 'movie' ? 'movie' : 'tv';

	// Labels only — keyword ids stay server-side so the client never builds TMDB
	// queries itself.
	const presets = MOOD_PRESETS.map((p) => p.label);

	try {
		return {
			mediaType,
			presets,
			rows: await getDiscoverRows(mediaType),
			moodAvailable: tmdbConfigured(),
			error: null
		};
	} catch (err) {
		return {
			mediaType,
			presets,
			rows: [],
			moodAvailable: tmdbConfigured(),
			error: err instanceof Error ? err.message : String(err)
		};
	}
};
