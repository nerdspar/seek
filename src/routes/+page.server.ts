import { getWatchlist } from '$lib/server/watchlist';
import { memo } from '$lib/server/memo';
import type { MediaType } from '$lib/types';
import type { PageServerLoad } from './$types';

const TYPES: MediaType[] = ['tv', 'movie', 'anime'];

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('type') as MediaType | null;
	const mediaType: MediaType = requested && TYPES.includes(requested) ? requested : 'tv';

	try {
		/* Deliberately awaited rather than streamed: this is the launch screen, and
		   server-rendered rows beat an instant empty shell on a cold start. The
		   short cache is what keeps the 1.2s Floppy query off the critical path
		   for tab switches. Marking invalidates it. */
		const page = await memo(`watchlist:${mediaType}`, 60 * 1000, () => getWatchlist(mediaType));
		return { mediaType, ...page, error: null };
	} catch (err) {
		// A dead Floppy should render an explainable screen, not a 500.
		return {
			mediaType,
			rows: [],
			total: 0,
			hasMore: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
};
