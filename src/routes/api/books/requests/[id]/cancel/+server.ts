import { json, error } from '@sveltejs/kit';
import { cancelRequest } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

/** Call off one of your book requests. */
export const POST: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad request id.');
	try {
		return json({ request: await cancelRequest(id) });
	} catch (e) {
		relayRefusal(e);
	}
};
