import { json, error } from '@sveltejs/kit';
import { listMyRequests, requestBook } from '$lib/server/books/bookorbit';
import { getEntry, saveEntry } from '$lib/server/books/entries';
import { relayRefusal } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

/** Your book requests (BookOrbit fetches them: approval → Prowlarr → library). */
export const GET: RequestHandler = async () => json({ requests: await listMyRequests() });

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Ask BookOrbit to get a book you found in Discover. It goes on your
 *  want-to-read list too (unless you already track it) — asking for a book is
 *  wanting to read it. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const hardcoverId = Number(body.hardcoverId);
	const title = str(body.title);
	if (!Number.isInteger(hardcoverId) || hardcoverId <= 0) error(400, 'Bad book id.');
	if (!title) error(400, 'A title is required.');
	const mediaKind = body.mediaKind === 'audiobook' ? 'audiobook' : 'ebook';
	const coverUrl = str(body.coverUrl);
	const book = {
		hardcoverId,
		title,
		author: str(body.author),
		coverUrl: coverUrl?.startsWith('https://assets.hardcover.app/') ? coverUrl : null,
		year: Number.isInteger(body.year) ? (body.year as number) : null
	};
	try {
		const out = await requestBook(book, mediaKind);
		if (!getEntry(book.hardcoverId)) saveEntry(book, { status: 'want_to_read' });
		return json(out);
	} catch (e) {
		// BookOrbit's refusals explain themselves ("Pick a destination library…").
		relayRefusal(e);
	}
};
