import { json, error } from '@sveltejs/kit';
import { bookDetail, hardcoverConfigured } from '$lib/server/books/hardcover';
import { markOwned, ownedIndex } from '$lib/server/books/discovery';
import type { RequestHandler } from './$types';

/** One book's Hardcover detail for the book sheet, plus your copy if you own it. */
export const GET: RequestHandler = async ({ params }) => {
	if (!hardcoverConfigured()) error(404, 'Book discovery is not set up.');
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad book id.');
	const [detail, owned] = await Promise.all([bookDetail(id), ownedIndex()]);
	if (!detail) error(404, 'Hardcover has no such book.');
	const { owned: mine, wished } = markOwned([detail], owned)[0];
	return json({ ...detail, owned: mine, wished });
};
