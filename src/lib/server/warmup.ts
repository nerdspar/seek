/**
 * Cache warmup — fire the expensive lookups ahead of time rather than making
 * whoever opens a tab first wait for them. Floppy needs ~13s to page a full
 * library and ~9s for an all-time statistics overview; neither should land on a
 * tap.
 *
 * Per person: the caches it fills are namespaced to the current user (memo), so
 * this runs once per account, as that account — at boot for everyone, and again
 * for one person right after they set up or link their Floppy.
 *
 * Sequential on purpose. Firing them together makes Floppy serve three heavy
 * queries at once, which slowed each of them enough to blow the request timeout
 * — the warmup was defeating itself. The watchlist goes first because it is the
 * launch screen.
 */
import { warmCaches as warmUpcoming } from './upcoming';
import { getWatchlist, knownServices } from './watchlist';
import { getPrefs, SORTS, sortFor } from './prefs';
import { COUNTS_KEY, COUNTS_TTL, getCollectionCounts, getStats } from './stats';
import { getDiscoverRows } from './discover';
import { memo } from './memo';
import { NotLinkedError, currentUser, runAs } from './userctx';
import { forEachUser } from './scheduler';
import type { User } from './users';

/** Warm everything for the current user. */
export async function warmForCurrentUser(): Promise<void> {
	const who = currentUser()?.name ?? 'legacy';
	let notLinked = false;
	const step = (label: string, run: () => Promise<unknown>) =>
		run().catch((err) => {
			// No Floppy linked yet: every step will say the same — don't spam the log.
			if (err instanceof NotLinkedError) notLinked = true;
			else console.warn(`[seek] warmup ${label} failed for ${who}:`, err);
		});

	const prefs = await getPrefs().catch(() => null);
	const sortKey = prefs ? sortFor(prefs, 'tv') : 'recently_watched';
	const { sort, direction } = SORTS[sortKey];

	// The launch screen first, then the other tabs, then the collection views.
	await step('watchlist', () =>
		memo(`watchlist:tv:${sortKey}:in_progress:all:`, 60 * 1000, () =>
			getWatchlist('tv', { sort, direction })
		)
	);
	if (notLinked) return;

	/* The movie tab opens on every status rather than the in-progress backlog —
	   see the note in +page.server.ts — so this is the key it actually asks for. */
	const movieSortKey = prefs ? sortFor(prefs, 'movie') : 'recently_watched';
	const movieSort = SORTS[movieSortKey];
	await step('watchlist:movie', () =>
		memo(`watchlist:movie:${movieSortKey}:all:all:`, 60 * 1000, () =>
			getWatchlist('movie', {
				sort: movieSort.sort,
				direction: movieSort.direction,
				statuses: ['all']
			})
		)
	);

	/* All four ranges, not just the default. Each is a separate ~5-9s query on
	   Floppy, so the first tap on a range used to pay full price — and there are
	   only four, so there is nothing to be gained by being selective. */
	for (const range of ['all_time', 'this_year', 'last_year', 'this_month'] as const) {
		await step(`stats:${range}`, () => memo(`stats:${range}`, 30 * 60 * 1000, () => getStats(range)));
	}

	/* Two more round trips that the Profile shell waits on regardless of range. */
	await step('collection:counts', () => memo(COUNTS_KEY, COUNTS_TTL, getCollectionCounts));
	await step('upcoming', () => warmUpcoming());
	await step('discover', () => memo('discover:tv', 30 * 60 * 1000, () => getDiscoverRows('tv')));
	await step('services', () => memo('services:all', 6 * 60 * 60 * 1000, knownServices));

	/* Each filter is its own cache key, and Floppy needs ~4.5s to return 200
	   completed rows — so a first tap on a status chip was paying full price.
	   These are the combinations reachable in a single tap from the default view. */
	for (const status of ['planning', 'completed', 'paused', 'dropped', 'all']) {
		await step(`filter:${status}`, () =>
			memo(`watchlist:tv:${sortKey}:${status}:all:`, 60 * 1000, () =>
				getWatchlist('tv', {
					sort,
					direction,
					statuses: status === 'all' ? ['all'] : [status]
				})
			)
		);
	}
	for (const company of ['joint', 'solo']) {
		await step(`filter:${company}`, () =>
			memo(`watchlist:tv:${sortKey}:in_progress:${company}:`, 60 * 1000, () =>
				getWatchlist('tv', { sort, direction, company: company as 'joint' | 'solo' })
			)
		);
	}
	// Collection views are the slowest cold path — two 200-row pages each.
	for (const mediaType of ['tv', 'movie'] as const) {
		await step(`library:${mediaType}`, () =>
			memo(`library:${mediaType}:all`, 60 * 1000, () =>
				getWatchlist(mediaType, {
					statuses: ['all'],
					sort: 'title',
					direction: 'asc',
					all: true,
					enrich: false
				})
			)
		);
	}
}

/** Warm every account, one after another (never in parallel — see above). */
export const warmEveryone = () => forEachUser(() => warmForCurrentUser());

/** Warm one account in the background, e.g. right after they link Floppy. */
export function warmInBackground(user: User): void {
	void runAs(user, () => warmForCurrentUser()).catch(() => {});
}
