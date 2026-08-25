import { redirect, type Handle } from '@sveltejs/kit';
import { COOKIE, gateEnabled, verify } from '$lib/server/session';
import { warmCaches } from '$lib/server/upcoming';
import { getWatchlist, knownServices } from '$lib/server/watchlist';
import { getPrefs, SORTS, sortFor } from '$lib/server/prefs';
import { getStats } from '$lib/server/stats';
import { getDiscoverRows } from '$lib/server/discover';
import { memo } from '$lib/server/memo';

/* Fire the expensive lookups once at startup rather than making whoever opens a
   tab first wait for them. Floppy needs ~13s to page a full library and ~9s for
   an all-time statistics overview; neither should land on a tap.

   Sequential on purpose. Firing them together makes Floppy serve three heavy
   queries at once, which slowed each of them enough to blow the request timeout
   — the warmup was defeating itself. The watchlist goes first because it is the
   launch screen. */
void (async () => {
	const step = (label: string, run: () => Promise<unknown>) =>
		run().catch((err) => console.warn(`[seek] warmup ${label} failed:`, err));

	const prefs = await getPrefs().catch(() => null);
	const sortKey = prefs ? sortFor(prefs, 'tv') : 'recently_watched';
	const { sort, direction } = SORTS[sortKey];

	// The launch screen first, then the other tabs, then the collection views.
	// Sequential so the warmup never competes with itself — doing these together
	// made Floppy slow enough to blow the request timeout.
	await step('watchlist', () =>
		memo(`watchlist:tv:${sortKey}:in_progress:all:`, 60 * 1000, () =>
			getWatchlist('tv', { sort, direction })
		)
	);
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
	   only four, so there is nothing to be gained by being selective. Warmed in
	   the order the tabs sit in, default first. memo serves stale entries while
	   refreshing behind them, so once these land, switching stays instant. */
	for (const range of ['all_time', 'this_year', 'last_year', 'this_month'] as const) {
		await step(`stats:${range}`, () =>
			memo(`stats:${range}`, 30 * 60 * 1000, () => getStats(range))
		);
	}
	await step('upcoming', () => warmCaches());
	await step('discover', () =>
		memo('discover:tv', 30 * 60 * 1000, () => getDiscoverRows('tv'))
	);
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
})();

/* The container's HEALTHCHECK cannot hold a session, so gating this path makes
   the container permanently unhealthy — which reads as "stuck deploying" in
   TrueNAS even though the app is serving fine. It stays reachable, and answers
   an unauthenticated caller with nothing but ok/not-ok. */
const UNGATED = new Set(['/login', '/api/health']);

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.authed = !gateEnabled() || verify(event.cookies.get(COOKIE));

	if (!event.locals.authed && !UNGATED.has(event.url.pathname)) {
		// API routes get a status, not a redirect to an HTML page.
		if (event.url.pathname.startsWith('/api/')) {
			return new Response('Unauthorized', { status: 401 });
		}
		redirect(303, '/login');
	}
	return resolve(event);
};
