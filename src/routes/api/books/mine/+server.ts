import { json, error } from '@sveltejs/kit';
import { setPages, setRating, setStatus } from '$lib/server/books/shelf';
import { HardcoverError } from '$lib/server/books/hardcover';
import { NotLinkedError } from '$lib/server/userctx';
import { invalidate } from '$lib/server/memo';
import { ENTRY_STATUSES, type EntryStatus } from '$lib/books';
import type { RequestHandler } from './$types';

/**
 * Change one thing about a book on your Hardcover shelf — any book, in the
 * library or not: `{ hardcoverId, status }` (null takes it off your shelf),
 * `{ hardcoverId, rating }` (1–5, null clears), or `{ hardcoverId, pages }`.
 */
export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const hardcoverId = Number(body.hardcoverId);
	if (!Number.isInteger(hardcoverId) || hardcoverId <= 0) error(400, 'Bad book id.');

	try {
		if ('status' in body) {
			if (body.status !== null && !ENTRY_STATUSES.includes(body.status)) error(400, 'Unknown status.');
			await setStatus(hardcoverId, body.status as EntryStatus | null);
		} else if ('rating' in body) {
			const r = body.rating;
			if (r !== null && !(Number.isInteger(r) && r >= 1 && r <= 5)) error(400, 'A rating is 1 to 5.');
			await setRating(hardcoverId, r);
		} else if ('pages' in body) {
			if (!(Number.isInteger(body.pages) && body.pages >= 0)) error(400, 'Pages read is a whole number.');
			await setPages(hardcoverId, body.pages);
		} else {
			error(400, 'Nothing to change.');
		}
	} catch (e) {
		if (e instanceof NotLinkedError) error(409, e.message);
		if (e instanceof HardcoverError) error(502, `${e.message} — nothing changed.`);
		throw e;
	}
	// Recommendations and the upcoming books grow from your shelf.
	invalidate('books:personal');
	return json({ ok: true });
};
