/**
 * What the search results area shows once a query is typed. A pure decision so
 * the three result kinds — your list, fresh TMDB titles, and books — stay
 * independent: a TMDB title-search error must never hide books that loaded
 * fine, and "Nothing found" must not shout over an error banner that already
 * explains the gap. Kept here (not in the component) so it's testable.
 */
export type SearchScope = 'best' | 'tv' | 'movie' | 'books';

export type SearchSections = {
	/** Your-list matches (titles only; never under the Books chip). */
	showOnList: boolean;
	/** New-to-you TMDB titles (titles only). */
	showFresh: boolean;
	/** Book matches — shown under All and Books, regardless of a TMDB error. */
	showBooks: boolean;
	/** Spinner while the first results are still arriving and nothing is shown yet. */
	showSearching: boolean;
	/** "Nothing found" — only when truly empty, settled, and no error to show instead. */
	showEmpty: boolean;
};

export function searchSections(c: {
	scope: SearchScope;
	onListCount: number;
	freshCount: number;
	booksCount: number;
	searching: boolean;
	bookSearching: boolean;
	failed: boolean;
}): SearchSections {
	const titles = c.scope !== 'books';
	const showOnList = titles && c.onListCount > 0;
	const showFresh = titles && c.freshCount > 0;
	const showBooks = c.booksCount > 0;
	const nothing = !showOnList && !showFresh && !showBooks;
	const settling = c.searching || c.bookSearching;
	return {
		showOnList,
		showFresh,
		showBooks,
		showSearching: nothing && settling,
		showEmpty: nothing && !settling && !c.failed
	};
}
