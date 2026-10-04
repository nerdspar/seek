import { json, error } from '@sveltejs/kit';
import { readingGoal, setGoal } from '$lib/server/books/shelf';
import { HardcoverError } from '$lib/server/books/hardcover';
import { NotLinkedError } from '$lib/server/userctx';
import type { RequestHandler } from './$types';

/** Set your yearly reading goal (books), on Hardcover. */
export const PUT: RequestHandler = async ({ request }) => {
	const books = Number((await request.json().catch(() => ({}))).books);
	if (!Number.isInteger(books) || books < 1 || books > 1000) error(400, 'A goal is between 1 and 1000 books.');
	try {
		await setGoal(books);
		return json({ goal: await readingGoal() });
	} catch (e) {
		if (e instanceof NotLinkedError) error(409, e.message);
		if (e instanceof HardcoverError) error(502, `${e.message} — nothing changed.`);
		throw e;
	}
};
