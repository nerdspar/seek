import { json, error } from '@sveltejs/kit';
import { setBookRating } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

/** Your rating (1–5, or null) on a book in your library (BookOrbit, per person). */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const bookId = Number(body.bookId);
	const rating = body.rating === null ? null : Number(body.rating);
	if (!Number.isInteger(bookId) || bookId <= 0) error(400, 'Bad book id.');
	if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) error(400, 'A rating is 1 to 5.');
	await setBookRating(bookId, rating).catch(relayRefusal);
	return json({ rating });
};
