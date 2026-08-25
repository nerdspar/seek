import { redirect, type Handle } from '@sveltejs/kit';
import { COOKIE, gateEnabled, verify } from '$lib/server/session';
import { warmCaches } from '$lib/server/upcoming';
import { getWatchlist } from '$lib/server/watchlist';
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
	await step('stats', () => memo('stats:all_time', 30 * 60 * 1000, () => getStats('all_time')));
	await step('upcoming', () => warmCaches());
	await step('discover', () =>
		memo('discover:tv', 30 * 60 * 1000, () => getDiscoverRows('tv'))
	);
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

export const handle: Handle = async ({ event, resolve }) => {
	if (gateEnabled() && event.url.pathname !== '/login') {
		if (!verify(event.cookies.get(COOKIE))) {
			// API routes get a status, not a redirect to an HTML page.
			if (event.url.pathname.startsWith('/api/')) {
				return new Response('Unauthorized', { status: 401 });
			}
			redirect(303, '/login');
		}
	}
	return resolve(event);
};
