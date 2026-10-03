import { json, error } from '@sveltejs/kit';
import { setReadingGoal } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

/** Set your yearly reading goal (books). */
export const PUT: RequestHandler = async ({ request }) => {
	const books = Number((await request.json().catch(() => ({}))).books);
	if (!Number.isInteger(books) || books < 1 || books > 1000) error(400, 'A goal is between 1 and 1000 books.');
	return json({ goal: await setReadingGoal(books).catch(relayRefusal) });
};
