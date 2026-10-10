import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { currentUser } from '$lib/server/userctx';
import type { LibraryTitle } from '$lib/librarySearch';
import type { RequestHandler } from './$types';

/** Everything on your list, shows and films, any status — what the watchlist's
 *  search box filters as you type. A few hundred small rows. */
export const GET: RequestHandler = async () => {
	const me = currentUser();
	if (!me) error(401);
	const rows = db()
		.prepare(
			`SELECT k.media_type, k.tmdb_id, k.status, t.title, t.poster, t.release_date
			FROM tracked k LEFT JOIN titles t ON t.media_type = k.media_type AND t.tmdb_id = k.tmdb_id
			WHERE k.user_id = ?`
		)
		.all(me.id) as { media_type: 'tv' | 'movie'; tmdb_id: number; status: number; title: string | null; poster: string | null; release_date: string | null }[];
	const titles: LibraryTitle[] = rows
		.filter((r) => r.title)
		.map((r) => {
			// A show's first air date, a film's release.
			const date = r.release_date ?? '';
			return {
				mediaType: r.media_type,
				mediaId: String(r.tmdb_id),
				title: r.title as string,
				poster: r.poster,
				status: r.status,
				year: date.length >= 4 ? Number(date.slice(0, 4)) : null
			};
		});
	return json({ titles });
};
