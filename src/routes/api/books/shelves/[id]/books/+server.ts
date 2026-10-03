import { json, error } from '@sveltejs/kit';
import { shelveBook } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

/** Put a book on this shelf (`on: true`) or take it off. */
export const POST: RequestHandler = async ({ params, request }) => {
	const shelfId = Number(params.id);
	const body = await request.json().catch(() => ({}));
	const bookId = Number(body.bookId);
	if (!Number.isInteger(shelfId) || shelfId <= 0) error(400, 'Bad shelf id.');
	if (!Number.isInteger(bookId) || bookId <= 0) error(400, 'Bad book id.');
	await shelveBook(shelfId, bookId, body.on !== false).catch(relayRefusal);
	return json({ ok: true });
};
