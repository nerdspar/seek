import { redirect } from '@sveltejs/kit';
import { getPrefs } from '$lib/server/prefs';
import { discoverRails, hardcoverConfigured } from '$lib/server/books/hardcover';
import { personalRails, railsWithOwned } from '$lib/server/books/discovery';
import { bookorbitLinked } from '$lib/server/books/bookorbit';
import { mediaOn } from '$lib/media';
import type { PageServerLoad } from './$types';

/**
 * Discover → Books: curated shelves from Hardcover's catalogue — popular, new,
 * coming soon, all-time, and "Because you read…/like…" recommendations — with
 * the books you already own badged. The browse-without-effort rows, like the
 * TV/Movies Discover; finding a specific book is the unified search's job.
 */
export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	if (!prefs.booksEnabled || !hardcoverConfigured()) redirect(303, '/discover');
	return {
		// Which other segments to offer (shows / movies can be switched off).
		media: mediaOn(prefs, hardcoverConfigured()),
		rails: discoverRails().then(railsWithOwned),
		// "Because you read…/like…": its own stream, so the standard shelves never
		// wait on it; a failure just means no personal shelves this time.
		personal: personalRails()
			.then(railsWithOwned)
			.catch(() => []),
		// Uploading goes into BookOrbit as you, so it needs your login there.
		canUpload: bookorbitLinked()
	};
};
