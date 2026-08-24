import { getWatchlist } from '$lib/server/watchlist';
import type { MediaType } from '$lib/types';
import type { PageServerLoad } from './$types';

const TYPES: MediaType[] = ['tv', 'movie', 'anime'];

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('type') as MediaType | null;
	const mediaType: MediaType = requested && TYPES.includes(requested) ? requested : 'tv';

	try {
		const page = await getWatchlist(mediaType);
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
