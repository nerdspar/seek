/**
 * Which view the book browser shows, as a pure decision shared by the component
 * and its test: a typed query searches, an active filter browses by facets, and
 * the bare state is the home shelves (popular + "Because you read…"). Kept here
 * so the precedence (search wins over filter) is testable and can't drift.
 */
export type BooksView = 'search' | 'filter' | 'home';

export function booksView(query: string, hasFilter: boolean): BooksView {
	if (query.trim()) return 'search';
	if (hasFilter) return 'filter';
	return 'home';
}
