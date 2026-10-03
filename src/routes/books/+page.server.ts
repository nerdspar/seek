import { redirect } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import {
	bookorbitConfigured,
	bookorbitLinked,
	getAllBooks,
	getReadingGoal,
	listMyRequests
} from '$lib/server/books/bookorbit';
import { hardcoverConfigured } from '$lib/server/books/hardcover';
import { listEntries } from '$lib/server/books/entries';
import { settleArrivals } from '$lib/server/books/discovery';
import type { ReadingBook } from '$lib/books';
import type { PageServerLoad } from './$types';

/**
 * Watchlist → Books: your reading list — your BookOrbit library (each person's
 * statuses and progress are their own) plus your own books outside it (Seek's).
 * Streamed like the other tabs, so the shell paints immediately. Without a
 * BookOrbit login you still get your own books; the page says how to link.
 */
export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	if (!prefs.booksEnabled || (!bookorbitConfigured() && !hardcoverConfigured())) redirect(303, '/');
	const linked = bookorbitLinked();
	return {
		linked,
		canLink: bookorbitConfigured(),
		// Your own books that have since landed carry their status over on the way in.
		library: linked ? getAllBooks().then(settleArrivals) : Promise.resolve([] as ReadingBook[]),
		// What you've asked BookOrbit to fetch; a nicety, never fails the page.
		requests: linked ? listMyRequests().catch(() => []) : Promise.resolve([]),
		// The goal is a nicety: never let it fail the page.
		goal: linked ? getReadingGoal().catch(() => null) : Promise.resolve(null),
		// Your books outside the library (Seek's own) — they join the list.
		entries: listEntries()
	};
};
