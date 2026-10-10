import { getDiscoverRows } from '$lib/server/discover';
import { memo } from '$lib/server/memo';
import { getPrefs } from '$lib/server/prefs';
import { bookorbitConfigured } from '$lib/server/books/bookorbit';
import { hardcoverConfigured } from '$lib/server/books/hardcover';
import { mediaOn } from '$lib/media';
import type { PageServerLoad } from './$types';

/**
 * Trending titles for search's empty state (§6.4 / Hobi's
 * `08-search-empty-trending`). Reuses Discover's own trending row rather than
 * calling TMDB again — it is already built, already cached, and already reflects what
 * the household is likely to recognise.
 */
export const load: PageServerLoad = async () => {
	const books = mediaOn((await getPrefs().catch(() => null)) ?? {}, bookorbitConfigured() || hardcoverConfigured()).book;
	try {
		const rows = await memo('discover:tv', 30 * 60 * 1000, () => getDiscoverRows('tv'));
		const trending =
			rows.find((r) => r.key === 'trending_right_now') ?? rows.find((r) => r.items.length);

		return {
			books,
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
		return { books, trending: [] };
	}
};
