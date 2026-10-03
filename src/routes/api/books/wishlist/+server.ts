import { json, error } from '@sveltejs/kit';
import { addToWishlist, listWishlist, removeFromWishlist } from '$lib/server/books/wishlist';
import type { RequestHandler } from './$types';

/** Your books wishlist — "want to read" for books you don't own (Seek's own). */
export const GET: RequestHandler = async () => json({ wishlist: listWishlist() });

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const hardcoverId = Number(body.hardcoverId);
	const title = str(body.title);
	if (!Number.isInteger(hardcoverId) || hardcoverId <= 0) error(400, 'Bad book id.');
	if (!title) error(400, 'A title is required.');
	const coverUrl = str(body.coverUrl);
	addToWishlist({
		hardcoverId,
		title,
		author: str(body.author),
		// Only Hardcover's asset host — the thumbnailer won't fetch anything else anyway.
		coverUrl: coverUrl?.startsWith('https://assets.hardcover.app/') ? coverUrl : null,
		year: Number.isInteger(body.year) ? body.year : null
	});
	return json({ wished: true });
};

export const DELETE: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const hardcoverId = Number(body.hardcoverId);
	if (!Number.isInteger(hardcoverId) || hardcoverId <= 0) error(400, 'Bad book id.');
	removeFromWishlist(hardcoverId);
	return json({ wished: false });
};
