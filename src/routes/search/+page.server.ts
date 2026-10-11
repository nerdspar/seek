import { getDiscoverRows } from '$lib/server/discover';
import { memo } from '$lib/server/memo';
import { getPrefs } from '$lib/server/prefs';
import { bookorbitConfigured, bookorbitLinked } from '$lib/server/books/bookorbit';
import { hardcoverConfigured, BOOK_GENRES } from '$lib/server/books/hardcover';
import { mediaOn } from '$lib/media';
import type { PageServerLoad } from './$types';

/**
 * Trending titles for search's empty state (§6.4 / Hobi's
 * `08-search-empty-trending`). Reuses Discover's own trending row rather than
 * calling TMDB again — it is already built, already cached, and already reflects what
 * the household is likely to recognise.
 */
type TrendItem = { mediaId: string; source: string; mediaType: 'tv' | 'movie'; title: string; poster: string | null; year: number | null; tracked: boolean };

/** The trending shelf for one media type, for the empty-state suggestions. */
async function trendingFor(type: 'tv' | 'movie'): Promise<TrendItem[]> {
	try {
		const rows = await memo(`discover:${type}`, 30 * 60 * 1000, () => getDiscoverRows(type));
		const row = rows.find((r) => r.key === 'trending_right_now') ?? rows.find((r) => r.items.length);
		return (row?.items ?? []).slice(0, 12).map((i) => ({
			mediaId: i.mediaId,
			source: i.source,
			mediaType: i.mediaType,
			title: i.title,
			poster: i.poster,
			year: i.year,
			tracked: false
		}));
	} catch {
		// An empty state without suggestions is still a working search box.
		return [];
	}
}

export const load: PageServerLoad = async () => {
	const books = mediaOn((await getPrefs().catch(() => null)) ?? {}, bookorbitConfigured() || hardcoverConfigured()).book;
	// The Books scope browses too, not just searches: its genre chips and whether
	// uploading is offered. Only meaningful when books are on.
	const bookGenres = books ? BOOK_GENRES : [];
	const canUpload = books ? bookorbitLinked() : false;
	// Trending for the empty state, per media type so the Movies chip shows films.
	const [trending, trendingMovie] = await Promise.all([trendingFor('tv'), trendingFor('movie')]);
	return { books, bookGenres, canUpload, trending, trendingMovie };
};
