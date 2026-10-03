import { json, error } from '@sveltejs/kit';
import { getEntry, listEntries, removeEntry, saveEntry, type EntryChange } from '$lib/server/books/entries';
import { ENTRY_STATUSES, type EntryStatus } from '$lib/books';
import type { RequestHandler } from './$types';

/** Your books outside the library (Seek's own): status, rating, page. */
export const GET: RequestHandler = async () => json({ entries: listEntries() });

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown) => (Number.isInteger(v) ? (v as number) : null);

/** Track a book (or change status / rating / pages on one you track). */
export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const hardcoverId = Number(body.hardcoverId);
	if (!Number.isInteger(hardcoverId) || hardcoverId <= 0) error(400, 'Bad book id.');
	const existing = getEntry(hardcoverId);
	const title = str(body.title) ?? existing?.title;
	if (!title) error(400, 'A title is required.');
	const coverUrl = str(body.coverUrl);

	const change: EntryChange = {};
	if (body.status !== undefined) {
		if (!ENTRY_STATUSES.includes(body.status)) error(400, 'Unknown status.');
		change.status = body.status as EntryStatus;
	}
	if (body.rating !== undefined) change.rating = body.rating === null ? null : int(body.rating);
	if (body.progressPages !== undefined) change.progressPages = body.progressPages === null ? null : int(body.progressPages);

	try {
		const entry = saveEntry(
			{
				hardcoverId,
				title,
				author: str(body.author) ?? existing?.author ?? null,
				// Only Hardcover's asset host — the thumbnailer won't fetch anything else anyway.
				coverUrl: coverUrl?.startsWith('https://assets.hardcover.app/') ? coverUrl : (existing?.coverUrl ?? null),
				year: int(body.year) ?? existing?.year ?? null,
				pages: int(body.pages) ?? existing?.pages ?? null
			},
			change
		);
		return json({ entry });
	} catch (e) {
		error(400, (e as Error).message);
	}
};

/** Stop tracking a book. */
export const DELETE: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const hardcoverId = Number(body.hardcoverId);
	if (!Number.isInteger(hardcoverId) || hardcoverId <= 0) error(400, 'Bad book id.');
	removeEntry(hardcoverId);
	return json({ ok: true });
};
