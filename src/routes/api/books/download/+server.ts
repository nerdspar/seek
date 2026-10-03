import { json, error } from '@sveltejs/kit';
import { startDownload } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import { getEntry, saveEntry } from '$lib/server/books/entries';
import type { RequestHandler } from './$types';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Start downloading a book (the ebook or the audiobook): a self-serve BookOrbit
 * request if you may fetch books yourself — then search and grab — otherwise an
 * ordinary request that waits for approval. It joins your want-to-read list
 * unless you already track it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const hardcoverId = Number(body.hardcoverId);
	const title = str(body.title);
	if (!Number.isInteger(hardcoverId) || hardcoverId <= 0) error(400, 'Bad book id.');
	if (!title) error(400, 'A title is required.');
	const coverUrl = str(body.coverUrl);
	const book = {
		hardcoverId,
		title,
		author: str(body.author),
		coverUrl: coverUrl?.startsWith('https://assets.hardcover.app/') ? coverUrl : null,
		year: Number.isInteger(body.year) ? (body.year as number) : null
	};
	const out = await startDownload(book, body.mediaKind === 'audiobook' ? 'audiobook' : 'ebook').catch(relayRefusal);
	if (!getEntry(hardcoverId)) saveEntry(book, { status: 'want_to_read' });
	return json(out);
};
