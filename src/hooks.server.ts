import { redirect, type Handle } from '@sveltejs/kit';
import { COOKIE, gateEnabled, verify } from '$lib/server/session';
import { warmCaches } from '$lib/server/upcoming';
import { getWatchlist } from '$lib/server/watchlist';
import { getPrefs, SORTS, sortFor } from '$lib/server/prefs';
import { getStats } from '$lib/server/stats';
import { memo } from '$lib/server/memo';

/* Fire the expensive lookups once at startup rather than making whoever opens a
   tab first wait for them. Floppy needs ~13s to page a full library and ~9s for
   an all-time statistics overview; neither should land on a tap.

   Sequential on purpose. Firing them together makes Floppy serve three heavy
   queries at once, which slowed each of them enough to blow the request timeout
   — the warmup was defeating itself. The watchlist goes first because it is the
   launch screen. */
void (async () => {
	const step = (run: () => Promise<unknown>) => run().catch(() => {});
	await step(async () => {
		const prefs = await getPrefs();
		const key = sortFor(prefs, 'tv');
		const { sort, direction } = SORTS[key];
		// Same key shape the page load builds, so the warmup actually lands on the
		// entry the default view will read.
		return memo(`watchlist:tv:${key}:in_progress:all:`, 60 * 1000, () =>
			getWatchlist('tv', { sort, direction })
		);
	});
	await step(() => memo('stats:all_time', 30 * 60 * 1000, () => getStats('all_time')));
	await step(async () => warmCaches());
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
