import { json, error } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { discoverRails, hardcoverConfigured } from '$lib/server/books/hardcover';
import { personalRails, railsWithOwned } from '$lib/server/books/discovery';
import type { RequestHandler } from './$types';

/**
 * The Books browse home: the standard discovery shelves and the personal
 * "Because you read…/like…" ones, each with the books you already own badged.
 * What Discover → Books used to stream from its page load — now an endpoint so
 * the unified search's Books scope can browse without its own server load.
 */
export const GET: RequestHandler = async () => {
	const prefs = await getPrefs().catch(() => null);
	if (!prefs?.booksEnabled || !hardcoverConfigured()) error(404, 'Book discovery is not set up.');
	const [rails, personal] = await Promise.all([
		discoverRails().then(railsWithOwned),
		personalRails()
			.then(railsWithOwned)
			.catch(() => [])
	]);
	return json({ rails, personal });
};
