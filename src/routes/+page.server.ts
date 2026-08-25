import { getWatchlist } from '$lib/server/watchlist';
import { memo } from '$lib/server/memo';
import { getPrefs, SORTS, sortFor } from '$lib/server/prefs';
import type { MediaType } from '$lib/types';
import type { PageServerLoad } from './$types';

const TYPES: MediaType[] = ['tv', 'movie', 'anime'];

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('type') as MediaType | null;
	const mediaType: MediaType = requested && TYPES.includes(requested) ? requested : 'tv';

	/* Sort lives in server-side preferences (§4.5, §8) rather than the browser:
	   a default kept client-side would render one order and reshuffle on hydrate. */
	const prefs = await getPrefs();
	const sortKey = sortFor(prefs, mediaType);
	const { sort, direction } = SORTS[sortKey];

	try {
		/* Deliberately awaited rather than streamed: this is the launch screen, and
		   server-rendered rows beat an instant empty shell on a cold start. The
		   short cache is what keeps the 1.2s Floppy query off the critical path
		   for tab switches. Marking invalidates it. */
		const page = await memo(`watchlist:${mediaType}:${sortKey}`, 60 * 1000, () =>
			getWatchlist(mediaType, { sort, direction })
		);
		return { mediaType, sortKey, ...page, error: null };
	} catch (err) {
		// A dead Floppy should render an explainable screen, not a 500.
		return {
			mediaType,
			sortKey,
			rows: [],
			total: 0,
			hasMore: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
};
