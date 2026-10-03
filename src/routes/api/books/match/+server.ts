import { json } from '@sveltejs/kit';
import { hardcoverConfigured } from '$lib/server/books/hardcover';
import { matchHardcover } from '$lib/server/books/discovery';
import type { RequestHandler } from './$types';

/** Which Hardcover book a library book is, by exact title + author — for the
 *  book sheet when BookOrbit hasn't recorded a Hardcover id yet. */
export const GET: RequestHandler = async ({ url }) => {
	const title = (url.searchParams.get('title') ?? '').trim();
	if (!title || !hardcoverConfigured()) return json({ hardcoverId: null });
	const author = url.searchParams.get('author');
	try {
		return json({ hardcoverId: await matchHardcover(title, author) });
	} catch {
		return json({ hardcoverId: null });
	}
};
