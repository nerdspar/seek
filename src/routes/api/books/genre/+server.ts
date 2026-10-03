import { json, error } from '@sveltejs/kit';
import { BOOK_GENRES, genreBooks, hardcoverConfigured } from '$lib/server/books/hardcover';
import { railsWithOwned } from '$lib/server/books/discovery';
import type { RequestHandler } from './$types';

/** A genre chip's shelves: what's new in it, and its all-time favourites —
 *  with the books you already have badged. */
export const GET: RequestHandler = async ({ url }) => {
	if (!hardcoverConfigured()) error(404, 'Book discovery is not set up.');
	const genre = BOOK_GENRES.find((g) => g.toLowerCase() === (url.searchParams.get('g') ?? '').toLowerCase());
	if (!genre) error(400, 'Unknown genre.');
	const { recent, popular } = await genreBooks(genre);
	const rails = await railsWithOwned(
		[
			{ key: `recent-${genre}`, title: `New in ${genre}`, subtitle: 'The most-read of the last couple of years.', books: recent },
			{ key: `popular-${genre}`, title: `${genre} favourites`, subtitle: 'The most-read of all time.', books: popular }
		].filter((r) => r.books.length)
	);
	return json({ rails });
};
