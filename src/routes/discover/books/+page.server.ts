import { redirect } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { BOOK_GENRES, discoverRails, hardcoverConfigured } from '$lib/server/books/hardcover';
import { personalRails, railsWithOwned } from '$lib/server/books/discovery';
import { bookorbitLinked } from '$lib/server/books/bookorbit';
import type { PageServerLoad } from './$types';

/** Discover → Books: shelves from Hardcover's catalog, with the books you
 *  already own in BookOrbit badged. Streamed so the header paints at once. */
export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	if (!prefs.booksEnabled || !hardcoverConfigured()) redirect(303, '/discover');
	return {
		rails: discoverRails().then(railsWithOwned),
		// "Because you read…/like…": its own stream, so the standard shelves never
		// wait on it; a failure just means no personal shelves this time.
		personal: personalRails()
			.then(railsWithOwned)
			.catch(() => []),
		genres: BOOK_GENRES,
		// Uploading goes into BookOrbit as you, so it needs your login there.
		canUpload: bookorbitLinked()
	};
};
