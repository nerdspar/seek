import { redirect } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { hardcoverConfigured } from '$lib/server/books/hardcover';
import type { PageServerLoad } from './$types';

/** Book finding now lives in the unified search's Books scope — this page is
 *  retired and just forwards there (or back to Discover when books are off). */
export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	if (!prefs.booksEnabled || !hardcoverConfigured()) redirect(303, '/discover');
	redirect(303, '/search?scope=books');
};
