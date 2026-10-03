import { json, error } from '@sveltejs/kit';
import { BookOrbitError, cancelRequest } from '$lib/server/books/bookorbit';
import type { RequestHandler } from './$types';

/** Call off one of your book requests. */
export const POST: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad request id.');
	try {
		return json({ request: await cancelRequest(id) });
	} catch (e) {
		if (e instanceof BookOrbitError && e.status < 500) error(e.status === 403 ? 403 : 400, e.message);
		throw e;
	}
};
