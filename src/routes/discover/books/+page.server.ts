import { redirect } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { discoverRails, hardcoverConfigured } from '$lib/server/books/hardcover';
import { railsWithOwned } from '$lib/server/books/discovery';
import type { PageServerLoad } from './$types';

/** Discover → Books: shelves from Hardcover's catalog, with the books you
 *  already own in BookOrbit badged. Streamed so the header paints at once. */
export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	if (!prefs.booksEnabled || !hardcoverConfigured()) redirect(303, '/discover');
	return { rails: discoverRails().then(railsWithOwned) };
};
