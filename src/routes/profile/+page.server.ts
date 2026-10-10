import {
	getCollectionCounts,
	getStats,
	type RangeKey,
	type Stats
} from '$lib/server/stats';
import { getRecentlyAdded } from '$lib/server/watchlist';
import { getPrefs } from '$lib/server/prefs';
import { listGoals, readingLog, shelfLinked } from '$lib/server/books/shelf';
import { myBookList } from '$lib/server/books/discovery';
import { bookorbitConfigured, bookorbitLinked, listShelves } from '$lib/server/books/bookorbit';
import { hardcoverConfigured } from '$lib/server/books/hardcover';
import { mediaOn } from '$lib/media';
import type { ReadingLogEntry } from '$lib/books';
import type { PageServerLoad } from './$types';

const RANGES: RangeKey[] = ['this_month', 'this_year', 'last_year', 'all_time'];

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('range') as RangeKey | null;
	const range: RangeKey = requested && RANGES.includes(requested) ? requested : 'all_time';

	/* Streamed, and always fresh: worked out from your plays in Seek's own
	   tables in tens of milliseconds, so nothing is cached to go stale. */
	const stats: Promise<Stats> = getStats(range);

	// Counts for the Collection rows (§7.2).
	const counts = getCollectionCounts();

	// Recently added, so a show you just tracked is easy to find again.
	const recentlyAdded = getRecentlyAdded(12);

	/* Your reading goals (Hardcover), when Books is on and you've linked your
	   own Hardcover account. Streamed; the shelf module caches them. */
	const prefs = await getPrefs();
	const media = mediaOn(prefs, bookorbitConfigured() || hardcoverConfigured());
	const reading = media.book && shelfLinked() ? listGoals() : null;

	/* Watching (shows + films) and Reading are separate views of the page;
	   whichever kinds are switched off simply aren't offered. */
	const watchingOn = media.tv || media.movie;
	const view: 'watching' | 'reading' =
		(url.searchParams.get('view') === 'reading' || !watchingOn) && media.book ? 'reading' : 'watching';

	return {
		range,
		stats,
		counts,
		recentlyAdded,
		reading,
		media,
		view,
		// Your books for the Reading view's numbers (computed client-side per range).
		books: media.book ? myBookList().catch(() => []) : null,
		// Your reading journal (Hardcover): pages by day, for the week chart,
		// streaks, pages read, and the genres/authors you've been reading.
		readingLog: media.book && shelfLinked() ? readingLog().catch(() => [] as ReadingLogEntry[]) : null,
		// Your book downloads show in Activity (the header's download icon).
		booksActivity: media.book && bookorbitLinked(),
		// Your BookOrbit shelves, for Collection → Shelves.
		shelves: media.book && bookorbitLinked() ? listShelves().catch(() => []) : null
	};
};
