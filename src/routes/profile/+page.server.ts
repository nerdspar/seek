import {
	COUNTS_KEY,
	COUNTS_TTL,
	getCollectionCounts,
	getStats,
	type RangeKey,
	type Stats
} from '$lib/server/stats';
import { getRecentlyAdded } from '$lib/server/watchlist';
import { memo } from '$lib/server/memo';
import { getPrefs } from '$lib/server/prefs';
import { readingGoal, shelfLinked } from '$lib/server/books/shelf';
import { myBookList } from '$lib/server/books/discovery';
import { bookorbitConfigured } from '$lib/server/books/bookorbit';
import { hardcoverConfigured } from '$lib/server/books/hardcover';
import { mediaOn } from '$lib/media';
import type { PageServerLoad } from './$types';

const RANGES: RangeKey[] = ['this_month', 'this_year', 'last_year', 'all_time'];

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('range') as RangeKey | null;
	const range: RangeKey = requested && RANGES.includes(requested) ? requested : 'all_time';

	/* Streamed, not awaited. Floppy takes 9.4s to compute an all-time overview,
	   and blocking the navigation on that made the tab look dead — the shell now
	   renders immediately and the numbers arrive when they arrive.
	   Cached for 30 minutes and warmed at boot, so in practice it is never slow:
	   a slightly stale hours count is harmless, a 9.5s stall is not. */
	const stats: Promise<Stats> = memo(`stats:${range}`, 30 * 60 * 1000, () => getStats(range));

	// Counts for the Collection rows (§7.2), warmed at boot — see hooks.server.ts.
	const counts = memo(COUNTS_KEY, COUNTS_TTL, getCollectionCounts);

	/* Recently added to the library, so a show you just tracked is easy to find
	   again. Streamed and cached; invalidated on add/remove (see /api/library) so
	   a fresh addition appears at once. Independent of `range`. */
	const recentlyAdded = memo('recent:added', 60 * 1000, () => getRecentlyAdded(12));

	/* This year's reading goal (Hardcover), when Books is on and you've linked
	   your own Hardcover account. Streamed; the shelf module caches it. */
	const prefs = await getPrefs();
	const media = mediaOn(prefs, bookorbitConfigured() || hardcoverConfigured());
	const reading = media.book && shelfLinked() ? readingGoal() : null;

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
		books: media.book ? myBookList().catch(() => []) : null
	};
};
