import { json, error } from '@sveltejs/kit';
import { discardHeldImport, fileHeldImport, getReview } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

const idOf = (raw: string) => {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad request id.');
	return id;
};

/** Why BookOrbit is holding a download: what you asked for vs what arrived. */
export const GET: RequestHandler = async ({ params }) => json({ review: await getReview(idOf(params.id)).catch(relayRefusal) });

/** Decide: `file` (it's the right book — add it to the library) or `discard`
 *  (wrong book — remove the download; the request is marked failed). */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = idOf(params.id);
	const { action } = await request.json().catch(() => ({}));
	if (action === 'file') return json({ request: await fileHeldImport(id).catch(relayRefusal) });
	if (action === 'discard') return json({ request: await discardHeldImport(id).catch(relayRefusal) });
	error(400, 'Choose file or discard.');
};
