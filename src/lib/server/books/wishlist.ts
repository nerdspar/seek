/**
 * The books wishlist — "want to read" for books you don't own yet (Seek's own,
 * per person). BookOrbit keeps status only for books in the library; everything
 * else someone wants to read lives here, so Seek can replace Goodreads' shelf.
 * Once the book is in the library, the library copy takes over (see books page).
 */
import { db, nowIso } from '../db';
import { currentUser } from '../userctx';
import type { BookCard, WishBook } from '$lib/books';

export type WishItem = WishBook;

type Row = {
	hardcover_id: number;
	title: string;
	author: string | null;
	cover_url: string | null;
	year: number | null;
	added_at: string;
};

function me(): number {
	const u = currentUser();
	if (!u) throw new Error('The wishlist needs a signed-in user.');
	return u.id;
}

const toItem = (r: Row): WishItem => ({
	hardcoverId: r.hardcover_id,
	title: r.title,
	author: r.author,
	coverUrl: r.cover_url,
	year: r.year,
	rating: null,
	addedAt: r.added_at
});

/** Your wishlist, newest first. */
export function listWishlist(): WishItem[] {
	return (
		db()
			.prepare('SELECT * FROM wishlist WHERE user_id = ? ORDER BY added_at DESC')
			.all(me()) as Row[]
	).map(toItem);
}

export function wishlistIds(): Set<number> {
	return new Set(
		(db().prepare('SELECT hardcover_id FROM wishlist WHERE user_id = ?').all(me()) as { hardcover_id: number }[]).map(
			(r) => r.hardcover_id
		)
	);
}

/** Add (or refresh) a book on your wishlist. */
export function addToWishlist(book: Pick<BookCard, 'hardcoverId' | 'title' | 'author' | 'coverUrl' | 'year'>): void {
	if (!Number.isInteger(book.hardcoverId) || book.hardcoverId <= 0) throw new Error('A Hardcover id is required.');
	if (!book.title?.trim()) throw new Error('A title is required.');
	db()
		.prepare(
			`INSERT INTO wishlist (user_id, hardcover_id, title, author, cover_url, year, added_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(user_id, hardcover_id) DO UPDATE SET
			   title = excluded.title, author = excluded.author,
			   cover_url = excluded.cover_url, year = excluded.year`
		)
		.run(me(), book.hardcoverId, book.title.trim(), book.author ?? null, book.coverUrl ?? null, book.year ?? null, nowIso());
}

export function removeFromWishlist(hardcoverId: number): void {
	db().prepare('DELETE FROM wishlist WHERE user_id = ? AND hardcover_id = ?').run(me(), hardcoverId);
}
