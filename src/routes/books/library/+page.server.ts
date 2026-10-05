import { redirect } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { shelfLinked } from '$lib/server/books/shelf';
import { myBookList } from '$lib/server/books/discovery';
import type { PageServerLoad } from './$types';

/**
 * Profile → Reading → Your books: everything on your Hardcover shelf, in the
 * library or not — the books side of the shows Library. BookOrbit books you
 * haven't touched aren't yours yet; they're in Discover → Books → In my library.
 */
export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	if (!prefs.booksEnabled) redirect(303, '/profile');
	const linked = shelfLinked();
	return {
		linked,
		books: linked ? myBookList().then((all) => all.filter((b) => b.status !== 'unread')) : Promise.resolve([])
	};
};
