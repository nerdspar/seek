import { redirect } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { bookorbitLinked, listShelves } from '$lib/server/books/bookorbit';
import { myBookList } from '$lib/server/books/discovery';
import type { PageServerLoad } from './$types';

/**
 * Discover → Books → In my library: the whole BookOrbit library (shared —
 * whatever anyone in the house added), each book with your own status on it.
 * Browsing to pick something; your own books are Profile → Reading → Your books.
 */
export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	if (!prefs.booksEnabled) redirect(303, '/discover');
	const linked = bookorbitLinked();
	return {
		linked,
		canUpload: linked,
		books: linked ? myBookList().then((all) => all.filter((b) => b.source === 'library')) : Promise.resolve([]),
		shelves: linked ? listShelves().catch(() => []) : Promise.resolve([])
	};
};
