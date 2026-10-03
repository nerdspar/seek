import { json, error } from '@sveltejs/kit';
import { getRequest } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import { BOOKORBIT_URL } from '$lib/server/env';
import type { RequestHandler } from './$types';

/** One of your requests as it is now — the download sheet polls this. */
export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad request id.');
	return json({ request: await getRequest(id).catch(relayRefusal), bookorbitUrl: BOOKORBIT_URL() || null });
};
