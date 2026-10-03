import { json, error } from '@sveltejs/kit';
import { searchBooks, hardcoverConfigured } from '$lib/server/books/hardcover';
import { markOwned, ownedIndex } from '$lib/server/books/discovery';
import type { RequestHandler } from './$types';

/** Search the whole book catalog (Hardcover), marking what you already own. */
export const GET: RequestHandler = async ({ url }) => {
	if (!hardcoverConfigured()) error(404, 'Book discovery is not set up.');
	const q = (url.searchParams.get('q') ?? '').trim();
	if (!q) return json({ results: [] });
	const [cards, owned] = await Promise.all([searchBooks(q), ownedIndex()]);
	return json({ results: markOwned(cards, owned) });
};
