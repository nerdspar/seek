import { redirect } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { bookorbitLinked, listShelves } from '$lib/server/books/bookorbit';
import { myBookList } from '$lib/server/books/discovery';
import type { PageServerLoad } from './$types';

/**
 * Profile → Reading → Library: the whole BookOrbit library (shared — whatever
 * anyone in the house downloaded), each book with your own status on it. Your
 * reading list (Watchlist → Books) is just your shelf; this is where you browse
 * everything else.
 */
export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	if (!prefs.booksEnabled) redirect(303, '/profile');
	const linked = bookorbitLinked();
	return {
		linked,
		canUpload: linked,
		books: linked ? myBookList().then((all) => all.filter((b) => b.source === 'library')) : Promise.resolve([]),
		shelves: linked ? listShelves().catch(() => []) : Promise.resolve([])
	};
};
