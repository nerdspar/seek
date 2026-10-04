import { json, error } from '@sveltejs/kit';
import { bookDetail, hardcoverConfigured } from '$lib/server/books/hardcover';
import { markOwned, ownedIndex } from '$lib/server/books/discovery';
import { bookorbitLinked, listMyRequests } from '$lib/server/books/bookorbit';
import { requestFor } from '$lib/books';
import { shelfEntry, shelfLinked } from '$lib/server/books/shelf';
import type { RequestHandler } from './$types';

/** One book's Hardcover detail for the book sheet, plus your library copy if
 *  there is one, your shelf entry if there isn't, and whether you've asked
 *  BookOrbit for it. */
export const GET: RequestHandler = async ({ params }) => {
	if (!hardcoverConfigured()) error(404, 'Book discovery is not set up.');
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad book id.');
	const linked = bookorbitLinked();
	const [detail, owned, mine, requests] = await Promise.all([
		bookDetail(id),
		ownedIndex(),
		shelfLinked() ? shelfEntry(id).catch(() => null) : null,
		// A nicety on the sheet: never let it fail the detail.
		linked ? listMyRequests().catch(() => []) : []
	]);
	if (!detail) error(404, 'Hardcover has no such book.');
	const { owned: lib } = markOwned([detail], owned)[0];
	return json({
		...detail,
		owned: lib,
		// In the library, `owned` carries your shelf state already.
		shelf: lib || !mine ? null : { status: mine.status, rating: mine.rating, progressPages: mine.progressPages },
		canRequest: linked,
		request: requestFor(requests, id)
	});
};
