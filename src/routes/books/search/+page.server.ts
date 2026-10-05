import { redirect } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { bookorbitLinked } from '$lib/server/books/bookorbit';
import { discoverRails, hardcoverConfigured } from '$lib/server/books/hardcover';
import { myBookList, personalRails, railsWithOwned } from '$lib/server/books/discovery';
import type { PageServerLoad } from './$types';

/**
 * Watchlist → Books → +: the book version of "Add to library". Search any book
 * (and your own), with suggestions while the box is empty — yours first
 * ("Because you read…"), then what's popular. Streamed, so the box is usable at once.
 */
export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	if (!prefs.booksEnabled || !hardcoverConfigured()) redirect(303, '/books');
	return {
		suggestions: Promise.all([personalRails().catch(() => []), discoverRails().catch(() => [])])
			.then(([mine, popular]) => railsWithOwned([...mine, ...popular.slice(0, 1)]))
			.catch(() => []),
		books: myBookList().catch(() => []),
		canDownload: bookorbitLinked(),
		canUpload: bookorbitLinked()
	};
};
