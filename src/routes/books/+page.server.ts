import { redirect } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { bookorbitConfigured, getAllBooks, getReadingGoal } from '$lib/server/books/bookorbit';
import { listWishlist } from '$lib/server/books/wishlist';
import { settleArrivals } from '$lib/server/books/discovery';
import { listMyRequests } from '$lib/server/books/bookorbit';
import type { PageServerLoad } from './$types';

/**
 * Watchlist → Books: your reading list, from *your* BookOrbit account (each
 * person's statuses and progress are their own). Streamed like the other tabs,
 * so the shell paints immediately; not having linked BookOrbit arrives as a
 * link-your-account prompt (handleError).
 */
export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	if (!prefs.booksEnabled || !bookorbitConfigured()) redirect(303, '/');
	return {
		// Wished books that have since landed become Want to read on the way in.
		library: getAllBooks().then(settleArrivals),
		// What you've asked BookOrbit to fetch; a nicety, never fails the page.
		requests: listMyRequests().catch(() => []),
		// The goal is a nicety: never let it fail the page.
		goal: getReadingGoal().catch(() => null),
		// Books you want but don't own yet — Seek's own list, joins "Want to read".
		wishlist: listWishlist()
	};
};
