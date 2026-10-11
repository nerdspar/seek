/**
 * Which view the book browser shows, as a pure decision shared by the component
 * and its test: a typed query searches, a picked genre shows that genre's
 * shelves, and the bare state is the home shelves (genre chips + "Because you
 * read…" + popular). Kept here so the precedence (search wins over genre) is
 * testable and can't drift.
 */
export type BooksView = 'search' | 'genre' | 'home';

export function booksView(query: string, genre: string | null): BooksView {
	if (query.trim()) return 'search';
	if (genre) return 'genre';
	return 'home';
}
