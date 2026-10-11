/**
 * The Discover filter: a set of facets you compose to browse for something,
 * shared by the sheet (where you build it) and the search page (where its
 * results render). Pure helpers so both sides agree and it's testable.
 */
export type Token = { id: number; name: string };
export type DiscoverSort = 'recommended' | 'top' | 'newest';

export type DiscoverFilter = {
	type: 'tv' | 'movie';
	genres: number[];
	keywords: Token[];
	people: Token[];
	providers: number[];
	/** Decade chips chosen (ERAS ids). Multiple select the span between them. */
	eras: string[];
	sort: DiscoverSort;
};

export const emptyFilter = (type: 'tv' | 'movie'): DiscoverFilter => ({
	type,
	genres: [],
	keywords: [],
	people: [],
	providers: [],
	eras: [],
	sort: 'recommended'
});

/** The decade chips, newest first, each a year window (Older = everything before). */
export const ERAS: { id: string; label: string; gte: number | null; lte: number | null }[] = [
	{ id: '2020s', label: '2020s', gte: 2020, lte: null },
	{ id: '2010s', label: '2010s', gte: 2010, lte: 2019 },
	{ id: '2000s', label: '2000s', gte: 2000, lte: 2009 },
	{ id: '90s', label: '90s', gte: 1990, lte: 1999 },
	{ id: 'older', label: 'Older', gte: null, lte: 1989 }
];

export const toggleEra = (eras: string[], id: string): string[] =>
	eras.includes(id) ? eras.filter((x) => x !== id) : [...eras, id];

/**
 * The year window the chosen decades span. Multiple decades become their
 * bounding range (earliest lower bound to latest upper bound) — a date-range
 * API can't express disjoint windows, so adjacent decades are exact and a gap
 * is filled in. An open-ended chip ("2020s", "Older") opens that end.
 */
export function eraBounds(eras: string[]): { gte: number | null; lte: number | null } {
	const chosen = ERAS.filter((e) => eras.includes(e.id));
	if (!chosen.length) return { gte: null, lte: null };
	const gte = chosen.some((e) => e.gte === null) ? null : Math.min(...chosen.map((e) => e.gte as number));
	const lte = chosen.some((e) => e.lte === null) ? null : Math.max(...chosen.map((e) => e.lte as number));
	return { gte, lte };
}

/** Anything chosen beyond the defaults? Drives whether the page browses or searches. */
export function isActive(f: DiscoverFilter): boolean {
	return Boolean(
		f.genres.length || f.keywords.length || f.people.length || f.providers.length || f.eras.length || f.sort !== 'recommended'
	);
}

/** The filter as query params for /api/discover/filter. */
export function filterQuery(f: DiscoverFilter): string {
	const q = new URLSearchParams({ type: f.type, sort: f.sort });
	if (f.genres.length) q.set('genres', f.genres.join(','));
	if (f.keywords.length) q.set('keywords', f.keywords.map((t) => t.id).join(','));
	if (f.people.length) q.set('people', f.people.map((t) => t.id).join(','));
	if (f.providers.length) q.set('providers', f.providers.join(','));
	const { gte, lte } = eraBounds(f.eras);
	if (gte) q.set('yearGte', String(gte));
	if (lte) q.set('yearLte', String(lte));
	return q.toString();
}
