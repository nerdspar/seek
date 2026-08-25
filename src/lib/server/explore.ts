/**
 * One search box over everything Discover can answer (§6.2).
 *
 * A query can plausibly mean several things — "Comedy" is a genre, "Netflix" a
 * service, "Sarah Michelle Gellar" a person, "Buffy" a title, "heist" a theme —
 * so rather than guessing one, every interpretation is resolved in parallel and
 * the ones that actually match are returned as separate sections, strongest
 * first. Typing "Buffy" gets you things like Buffy; typing "Bravo" gets you
 * what's on Bravo. No mode switch, no syntax.
 */
import { TMDB_API_KEY } from './env';
import { TTLCache } from './cache';
import { dedupe, discoverByKeyword, discoverByProvider, getProviders, keywordIds } from './tmdb';
import type { TmdbResult } from '$lib/types';

const BASE = 'https://api.themoviedb.org/3';

export type ExploreSection = {
	kind: 'person' | 'similar' | 'provider' | 'genre' | 'keyword';
	title: string;
	/** Why this section is here, shown under its heading. */
	why: string | null;
	items: TmdbResult[];
};

const cache = new TTLCache<ExploreSection[]>(60 * 60 * 1000, 300);

async function tmdb<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
	const key = TMDB_API_KEY();
	if (!key) throw new Error('TMDB_API_KEY is not set.');
	const search = new URLSearchParams({ api_key: key });
	for (const [k, v] of Object.entries(params)) search.set(k, String(v));
	const res = await fetch(`${BASE}${path}?${search}`, { signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`TMDB ${path} → ${res.status}`);
	return res.json() as Promise<T>;
}

const img = (p: string | null) => (p ? `https://image.tmdb.org/t/p/w500${p}` : null);
const yearOf = (d?: string) => (d && d.length >= 4 ? Number(d.slice(0, 4)) : null);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]/g, '');

type Row = {
	id: number;
	name?: string;
	title?: string;
	poster_path: string | null;
	first_air_date?: string;
	release_date?: string;
	vote_average?: number;
};

const toResult = (r: Row, mediaType: 'tv' | 'movie'): TmdbResult => ({
	mediaId: String(r.id),
	source: 'tmdb',
	mediaType,
	title: r.title ?? r.name ?? 'Untitled',
	poster: img(r.poster_path),
	year: yearOf(r.release_date ?? r.first_air_date),
	rating: typeof r.vote_average === 'number' ? Math.round(r.vote_average * 10) / 10 : null
});

/**
 * How confidently a candidate answers the query. Exact beats prefix beats
 * contains, so "Comedy" leads with the genre rather than a show with Comedy in
 * its name.
 */
function matchScore(query: string, candidate: string): number {
	const q = norm(query);
	const c = norm(candidate);
	if (!q || !c) return 0;
	if (q === c) return 3;
	if (c.startsWith(q) && q.length >= 3) return 2;
	if (c.includes(q) && q.length >= 4) return 1;
	return 0;
}

async function personSection(q: string, mediaType: 'tv' | 'movie'): Promise<[number, ExploreSection] | null> {
	const data = await tmdb<{ results?: { id: number; name: string; popularity: number }[] }>(
		'/search/person',
		{ query: q }
	);
	const person = (data.results ?? [])[0];
	if (!person) return null;

	const score = matchScore(q, person.name);

	/* Popularity is a poor filter here — Sarah Michelle Gellar scores 3.4 while
	   the "Buffy Chen" that a search for "Buffy" turns up scores 1.7. Exactness
	   separates them properly: accept a person only when the query is their whole
	   name, or when a multi-word query matches strongly. That keeps "Zendaya" and
	   "Bryan Cranston" while rejecting "Buffy" (which means the show) and
	   "Severance" (which is not Joan Severance). */
	const exact = norm(q) === norm(person.name);
	const multiWord = q.trim().split(/\s+/).length > 1;
	if (!exact && !(score >= 2 && multiWord)) return null;
	if (person.popularity < 0.5) return null;

	const credits = await tmdb<
		{ cast?: (Row & { popularity?: number; episode_count?: number; genre_ids?: number[] })[] }
	>(`/person/${person.id}/${mediaType === 'tv' ? 'tv_credits' : 'movie_credits'}`);

	/* Talk shows and news. Someone searching an actor wants the parts they played,
	   not the night they sat on Fallon's couch — and those appearances dominate on
	   popularity, because the show is popular even when the credit is trivial. */
	const CHAT = new Set([10767, 10763]);
	const LEAD = 15;

	/* One row per credit, so a voice actor with six guest spots on Family Guy gets
	   six rows. Fold them into one entry whose episode count is the total, which is
	   both the correct dedupe and the number the ranking below needs. */
	const byShow = new Map<number, Row & { popularity?: number; episodes: number }>();
	for (const c of credits.cast ?? []) {
		if (!c.poster_path) continue;
		if ((c.genre_ids ?? []).some((g) => CHAT.has(g))) continue;
		const prev = byShow.get(c.id);
		const episodes = (prev?.episodes ?? 0) + (c.episode_count ?? 0);
		if (!prev || (c.popularity ?? 0) > (prev.popularity ?? 0)) byShow.set(c.id, { ...c, episodes });
		else prev.episodes = episodes;
	}

	/* Rank by how much of the show they were actually in. Popularity alone puts a
	   one-line Simpsons cameo above Breaking Bad. The cap matters as much as the
	   sort: past roughly a season everyone is equally "in it", so the count stops
	   carrying information and popularity should decide. Uncapped, Zendaya's 62
	   episodes of K.C. Undercover bury Euphoria. Tuned against Cranston, Zendaya,
	   Gellar, Pascal and Carell — 15 was the value that put the expected title
	   first for all of them. */
	const items = dedupe(
		[...byShow.values()]
			.sort(
				(a, b) =>
					Math.min(b.episodes, LEAD) - Math.min(a.episodes, LEAD) ||
					(b.popularity ?? 0) - (a.popularity ?? 0)
			)
			.map((c) => toResult(c, mediaType))
	).slice(0, 18);

	if (!items.length) return null;
	return [
		exact ? score + 2 : score,
		{ kind: 'person', title: person.name, why: 'Appears in', items }
	];
}

async function similarSection(q: string, mediaType: 'tv' | 'movie'): Promise<[number, ExploreSection] | null> {
	const data = await tmdb<{ results?: Row[] }>(`/search/${mediaType}`, { query: q });
	const hit = (data.results ?? [])[0];
	if (!hit) return null;

	const name = hit.title ?? hit.name ?? '';
	const score = matchScore(q, name);
	if (score < 2) return null;

	const recs = await tmdb<{ results?: Row[] }>(`/${mediaType}/${hit.id}/recommendations`);
	const items = (recs.results ?? []).slice(0, 18).map((r) => toResult(r, mediaType));
	if (!items.length) return null;

	/* Only an exact title is promoted. A partial one is often coincidence — "time
	   travel" prefixes a show literally called "Time Travel Girl", which should
	   not outrank the theme the phrase obviously describes. */
	const exact = norm(q) === norm(name);
	return [
		exact ? score + 2 : 2,
		{ kind: 'similar', title: `Like ${name}`, why: 'Similar to', items }
	];
}

async function providerSection(q: string, mediaType: 'tv' | 'movie'): Promise<[number, ExploreSection] | null> {
	const providers = await getProviders();
	let best: { score: number; provider: (typeof providers)[number] } | null = null;
	for (const provider of providers) {
		const score = matchScore(q, provider.name);
		if (score && (!best || score > best.score)) best = { score, provider };
	}
	if (!best || best.score < 2) return null;

	const items = await discoverByProvider(best.provider.id, mediaType, 'trending');
	if (!items.length) return null;
	return [
		best.score + 1,
		{ kind: 'provider', title: `Trending on ${best.provider.name}`, why: 'On this service', items }
	];
}

const genreCache = new TTLCache<{ id: number; name: string }[]>(7 * 24 * 60 * 60 * 1000, 4);

async function genresFor(mediaType: 'tv' | 'movie') {
	const hit = genreCache.get(mediaType);
	if (hit) return hit;
	const data = await tmdb<{ genres?: { id: number; name: string }[] }>(`/genre/${mediaType}/list`);
	const genres = data.genres ?? [];
	genreCache.set(mediaType, genres);
	return genres;
}

async function genreSection(q: string, mediaType: 'tv' | 'movie'): Promise<[number, ExploreSection] | null> {
	const genres = await genresFor(mediaType);
	let best: { score: number; genre: { id: number; name: string } } | null = null;
	for (const genre of genres) {
		const score = matchScore(q, genre.name);
		if (score && (!best || score > best.score)) best = { score, genre };
	}
	if (!best || best.score < 2) return null;

	const data = await tmdb<{ results?: Row[] }>(`/discover/${mediaType}`, {
		with_genres: best.genre.id,
		sort_by: 'popularity.desc',
		'vote_count.gte': 50,
		include_adult: 'false'
	});
	const items = (data.results ?? []).slice(0, 18).map((r) => toResult(r, mediaType));
	if (!items.length) return null;

	return [best.score + 1, { kind: 'genre', title: best.genre.name, why: 'Genre', items }];
}

async function keywordSection(q: string, mediaType: 'tv' | 'movie'): Promise<[number, ExploreSection] | null> {
	const keywords = await keywordIds(q);
	if (!keywords.length) return null;
	const items = await discoverByKeyword({ keywords, mediaType });
	if (!items.length) return null;
	/* Resolving to a real TMDB keyword is itself evidence the phrase is a theme,
	   so this is not merely a fallback — it ties with a partial title match and
	   wins on resolver order. */
	return [2, { kind: 'keyword', title: q, why: 'Theme', items }];
}

export async function explore(query: string, mediaType: 'tv' | 'movie'): Promise<ExploreSection[]> {
	const q = query.trim();
	if (!q || !TMDB_API_KEY()) return [];

	const key = `${mediaType}:${q.toLowerCase()}`;
	const hit = cache.get(key);
	if (hit) return hit;

	/* Every interpretation runs at once. Each resolver decides for itself whether
	   it is plausible enough to include, so a query that only means one thing
	   returns one section rather than a page of noise. */
	// Order matters on ties: sort() is stable, so this is the preference when two
	// interpretations are equally plausible.
	const settled = await Promise.allSettled([
		providerSection(q, mediaType),
		genreSection(q, mediaType),
		personSection(q, mediaType),
		keywordSection(q, mediaType),
		similarSection(q, mediaType)
	]);

	const sections = settled
		.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []))
		.sort((a, b) => b[0] - a[0])
		// Defensive: every resolver is a distinct TMDB endpoint and any of them can
		// repeat a title. One duplicate anywhere would blank the page.
		.map(([, section]) => ({ ...section, items: dedupe(section.items) }));

	cache.set(key, sections);
	return sections;
}
