import { json, error } from '@sveltejs/kit';
import { createShelf, listShelves, shelvesFor } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

/** Your shelves — or, with `?bookId=`, your shelves marked with that book. */
export const GET: RequestHandler = async ({ url }) => {
	const raw = url.searchParams.get('bookId');
	if (raw === null) return json({ shelves: await listShelves().catch(relayRefusal) });
	const bookId = Number(raw);
	if (!Number.isInteger(bookId) || bookId <= 0) error(400, 'Bad book id.');
	return json({ shelves: await shelvesFor(bookId).catch(relayRefusal) });
};

const shelfName = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 255) : '');

/** Make a new shelf. */
export const POST: RequestHandler = async ({ request }) => {
	const name = shelfName((await request.json().catch(() => ({}))).name);
	if (!name) error(400, 'Give the shelf a name.');
	return json({ shelf: await createShelf(name).catch(relayRefusal) });
};
