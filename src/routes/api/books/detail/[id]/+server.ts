import { json, error } from '@sveltejs/kit';
import { bookDetail, hardcoverConfigured } from '$lib/server/books/hardcover';
import { markOwned, ownedIndex } from '$lib/server/books/discovery';
import { bookorbitLinked, listMyRequests } from '$lib/server/books/bookorbit';
import { requestFor } from '$lib/books';
import { getEntry } from '$lib/server/books/entries';
import type { RequestHandler } from './$types';

/** One book's Hardcover detail for the book sheet, plus your copy if you own it,
 *  and — if you don't — how you're tracking it yourself and whether you've
 *  asked BookOrbit for it. */
export const GET: RequestHandler = async ({ params }) => {
	if (!hardcoverConfigured()) error(404, 'Book discovery is not set up.');
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad book id.');
	const linked = bookorbitLinked();
	const [detail, owned, requests] = await Promise.all([
		bookDetail(id),
		ownedIndex(),
		// A nicety on the sheet: never let it fail the detail.
		linked ? listMyRequests().catch(() => []) : []
	]);
	if (!detail) error(404, 'Hardcover has no such book.');
	const { owned: lib } = markOwned([detail], owned)[0];
	return json({
		...detail,
		owned: lib,
		// Owning it supersedes your own entry (settleArrivals moves it across).
		entry: lib ? null : getEntry(id),
		canRequest: linked,
		request: requestFor(requests, id)
	});
};
