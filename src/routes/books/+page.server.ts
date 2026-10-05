import { redirect } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { bookorbitConfigured, bookorbitLinked, getAllBooks, listMyRequests } from '$lib/server/books/bookorbit';
import { hardcoverConfigured } from '$lib/server/books/hardcover';
import { listGoals, myShelf, shelfLinked } from '$lib/server/books/shelf';
import type { ReadingBook, ReadingGoalItem, ShelfBook } from '$lib/books';
import { mediaOn } from '$lib/media';
import type { PageServerLoad } from './$types';

/**
 * Watchlist → Books: your reading list — your Hardcover shelf (status, rating,
 * dates, pages — any book) joined to the BookOrbit library (what's here to
 * read). Streamed like the other tabs, so the shell paints immediately. Each
 * link is optional; the page says what linking either one adds.
 */
export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	if (!prefs.booksEnabled || (!bookorbitConfigured() && !hardcoverConfigured())) redirect(303, '/');
	const linked = bookorbitLinked();
	const onShelf = shelfLinked();
	return {
		// Which other segments to offer (shows / movies can be switched off).
		media: mediaOn(prefs, bookorbitConfigured() || hardcoverConfigured()),
		linked,
		canLink: bookorbitConfigured(),
		// What's in the library. A BookOrbit hiccup shows just your shelf.
		library: linked ? getAllBooks().catch(() => [] as ReadingBook[]) : Promise.resolve([] as ReadingBook[]),
		// Where you are with every book (your own Hardcover account).
		hardcoverLinked: onShelf,
		shelf: onShelf ? myShelf() : Promise.resolve([] as ShelfBook[]),
		// What you've asked BookOrbit to fetch; a nicety, never fails the page.
		requests: linked ? listMyRequests().catch(() => []) : Promise.resolve([]),
		// Your goals (the bar shows the books goal running today). A nicety:
		// never let it fail the page.
		goals: onShelf ? listGoals().catch(() => [] as ReadingGoalItem[]) : Promise.resolve([] as ReadingGoalItem[])
	};
};
