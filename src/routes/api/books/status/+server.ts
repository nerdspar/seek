import { json, error } from '@sveltejs/kit';
import { setReadStatus } from '$lib/server/books/bookorbit';
import type { BookReadStatus } from '$lib/books';
import type { RequestHandler } from './$types';

const STATUSES: BookReadStatus[] = [
	'unread',
	'want_to_read',
	'reading',
	'on_hold',
	'rereading',
	'read',
	'skimmed',
	'abandoned'
];

/** Set your reading status on a book you own (BookOrbit, per person). */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const bookId = Number(body.bookId);
	const status = body.status as BookReadStatus;
	if (!Number.isInteger(bookId) || bookId <= 0) error(400, 'Bad book id.');
	if (!STATUSES.includes(status)) error(400, 'Unknown status.');
	return json({ status: await setReadStatus(bookId, status) });
};
