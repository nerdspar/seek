/**
 * The watchlist's search box: your whole library, shows and films, filtered as
 * you type. Client-safe and pure, so it's instant and testable.
 */
export type LibraryTitle = {
	mediaType: 'tv' | 'movie';
	mediaId: string;
	title: string;
	poster: string | null;
	/** 0 Planning, 1 Watching, 2 Paused, 3 Completed, 4 Dropped. */
	status: number;
	year: number | null;
};

/** Lowercase, accents and punctuation off, a leading "the" dropped — so
 *  "re zero", "rezero" and "Re:ZERO" all find Re:ZERO. */
export function fold(s: string): string {
	return s
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/^the\s+/, '')
		.replace(/[^a-z0-9]+/g, '');
}

/** Titles matching `query`: those starting with it first, then what you're
 *  watching, then A–Z. */
export function searchLibrary(titles: LibraryTitle[], query: string, limit = 30): LibraryTitle[] {
	const q = fold(query);
	if (!q) return [];
	const rank = (t: LibraryTitle) => (fold(t.title).startsWith(q) ? 0 : 1) * 10 + (t.status === 1 ? 0 : t.status === 0 ? 1 : 2);
	return titles
		.filter((t) => fold(t.title).includes(q))
		.sort((a, b) => rank(a) - rank(b) || fold(a.title).localeCompare(fold(b.title)))
		.slice(0, limit);
}
