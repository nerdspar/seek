import { json, error } from '@sveltejs/kit';
import { abandonRequest } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

/** You closed the download sheet without grabbing anything: call the request
 *  off and hide it, so BookOrbit doesn't show it approved for nothing. */
export const POST: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad request id.');
	await abandonRequest(id).catch(relayRefusal);
	return json({ ok: true });
};
