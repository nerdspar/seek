import { json, error } from '@sveltejs/kit';
import { deleteShelf, renameShelf, shelfBooks } from '$lib/server/books/bookorbit';
import { relayRefusal } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

const idOf = (raw: string) => {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad shelf id.');
	return id;
};

/** The books on a shelf. */
export const GET: RequestHandler = async ({ params }) =>
	json({ books: await shelfBooks(idOf(params.id)).catch(relayRefusal) });

/** Rename a shelf. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await request.json().catch(() => ({}));
	const name = typeof body.name === 'string' ? body.name.trim().slice(0, 255) : '';
	if (!name) error(400, 'Give the shelf a name.');
	return json({ shelf: await renameShelf(idOf(params.id), name).catch(relayRefusal) });
};

/** Delete a shelf (its books stay in the library). */
export const DELETE: RequestHandler = async ({ params }) => {
	await deleteShelf(idOf(params.id)).catch(relayRefusal);
	return json({ ok: true });
};
