import { redirect, type Handle } from '@sveltejs/kit';
import { COOKIE, gateEnabled, verify } from '$lib/server/session';
import { warmCaches } from '$lib/server/upcoming';
import { getWatchlist } from '$lib/server/watchlist';
import { getStats } from '$lib/server/stats';
import { memo } from '$lib/server/memo';

/* Fire the expensive lookups once at startup rather than making whoever opens
   a tab first wait for them. Floppy needs ~13s to page a full library and ~9s
   for an all-time statistics overview; neither should land on a tap. */
warmCaches();
void memo('watchlist:tv', 60 * 1000, () => getWatchlist('tv')).catch(() => {});
// All-time is the default range and the slowest of them by far.
void memo('stats:all_time', 30 * 60 * 1000, () => getStats('all_time')).catch(() => {});

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
