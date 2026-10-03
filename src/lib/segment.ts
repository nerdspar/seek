/**
 * The segment you were last on — TV, Movies or Books — shared by Watchlist and
 * Discover, so switching tabs keeps you in the same kind of thing. Kept in
 * memory and (per device) in localStorage.
 */
export type Segment = 'tv' | 'movie' | 'book';
const KEY = 'seek:segment';
let current: Segment | null = null;

export function setSegment(s: Segment): void {
	current = s;
	try {
		localStorage.setItem(KEY, s);
	} catch {
		/* private mode: memory is enough */
	}
}

export function getSegment(): Segment | null {
	if (current) return current;
	try {
		const s = localStorage.getItem(KEY);
		if (s === 'tv' || s === 'movie' || s === 'book') current = s;
	} catch {
		/* nothing saved */
	}
	return current;
}

/** Where a tab goes for a segment. */
export function tabHref(tab: 'watchlist' | 'discover', s: Segment | null): string {
	if (tab === 'watchlist') return s === 'book' ? '/books' : s ? `/?type=${s}` : '/';
	return s === 'book' ? '/discover/books' : s ? `/discover?type=${s}` : '/discover';
}
