import { getDiscoverRows } from '$lib/server/discover';
import { memo } from '$lib/server/memo';
import type { PageServerLoad } from './$types';

/**
 * Trending titles for search's empty state (§6.4 / Hobi's
 * `08-search-empty-trending`). Reuses Floppy's own Discover row rather than
 * calling TMDB — it is already built, already cached, and already reflects what
 * the household is likely to recognise.
 */
export const load: PageServerLoad = async () => {
	try {
		const rows = await memo('discover:tv', 30 * 60 * 1000, () => getDiscoverRows('tv'));
		const trending =
			rows.find((r) => r.key === 'trending_right_now') ?? rows.find((r) => r.items.length);

		return {
			trending: (trending?.items ?? []).slice(0, 12).map((i) => ({
				mediaId: i.mediaId,
				source: i.source,
				mediaType: i.mediaType,
				title: i.title,
				poster: i.poster,
				year: i.year,
				tracked: false
			}))
		};
	} catch {
		// An empty state without suggestions is still a working search box.
		return { trending: [] };
	}
};
