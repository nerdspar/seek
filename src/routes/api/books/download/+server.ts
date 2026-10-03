import { json, error } from '@sveltejs/kit';
import { startDownload } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import { getEntry, saveEntry } from '$lib/server/books/entries';
import { bookIsbns } from '$lib/server/books/hardcover';
import { BOOKORBIT_URL } from '$lib/server/env';
import type { RequestHandler } from './$types';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Start downloading a book (the ebook or the audiobook): a self-serve BookOrbit
 * request if you may fetch books yourself — then search and grab — otherwise an
 * ordinary request that waits for approval. Called when you choose Automatic or
 * Choose, not when the sheet opens. The book joins your want-to-read list only
 * once something real happens: a grab (see grab/), or a request filed for
 * approval here.
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
	const kind = body.mediaKind === 'audiobook' ? 'audiobook' : 'ebook';
	const out = await startDownload(book, kind, await bookIsbns(hardcoverId)).catch(relayRefusal);
	if (!out.selfServe && !getEntry(hardcoverId)) saveEntry(book, { status: 'want_to_read' });
	return json({ ...out, bookorbitUrl: BOOKORBIT_URL() || null });
};
