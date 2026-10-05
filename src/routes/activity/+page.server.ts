import { getPrefs } from '$lib/server/prefs';
import { bookorbitLinked } from '$lib/server/books/bookorbit';
import type { PageServerLoad } from './$types';

/** Whether Activity shows your book downloads (BookOrbit) beside Sonarr/Radarr. */
export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	return { books: prefs.booksEnabled && bookorbitLinked() };
};
