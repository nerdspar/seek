import { json, error } from '@sveltejs/kit';
import { searchReleases } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

/** Search your download sources for releases of this request's book. */
export const POST: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad request id.');
	return json(await searchReleases(id).catch(relayRefusal));
};
