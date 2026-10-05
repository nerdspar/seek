import { json } from '@sveltejs/kit';
import { wantedBooks } from '$lib/books';
import { bookorbitLinked, listMyRequests } from '$lib/server/books/bookorbit';
import { myBookList } from '$lib/server/books/discovery';
import type { RequestHandler } from './$types';

/** Activity → Wanted for books: your Want to read with no library copy and no
 *  download under way (Sonarr's "missing", for books). */
export const GET: RequestHandler = async () => {
	if (!bookorbitLinked()) return json({ wanted: [] });
	const [books, requests] = await Promise.all([myBookList(), listMyRequests()]);
	return json({ wanted: wantedBooks(books, requests) });
};
