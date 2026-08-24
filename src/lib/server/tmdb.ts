/**
 * TMDB, for the mood/theme search Floppy has no equivalent for (§6.2).
 * Server-only — the key never reaches the browser.
 */
import { TMDB_API_KEY } from './env';
import { TTLCache } from './cache';
import type { TmdbResult } from '$lib/types';

const BASE = 'https://api.themoviedb.org/3';

/** Keyword ids are stable and provider lists move slowly; cache both hard. */
const keywordCache = new TTLCache<number[]>(7 * 24 * 60 * 60 * 1000, 500);
const discoverCache = new TTLCache<TmdbResult[]>(60 * 60 * 1000, 300);


export const tmdbConfigured = () => Boolean(TMDB_API_KEY());

async function tmdb<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
	const key = TMDB_API_KEY();
	if (!key) throw new Error('TMDB_API_KEY is not set — mood search is unavailable.');

	const search = new URLSearchParams({ api_key: key });
	for (const [k, v] of Object.entries(params)) search.set(k, String(v));

	const res = await fetch(`${BASE}${path}?${search}`, { signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`TMDB ${path} → ${res.status}`);
	return res.json() as Promise<T>;
}

const img = (p: string | null) => (p ? `https://image.tmdb.org/t/p/w500${p}` : null);
const yearOf = (d?: string) => (d && d.length >= 4 ? Number(d.slice(0, 4)) : null);

/** Free text → keyword ids. Chips bypass this by carrying their id already. */
export async function keywordIds(query: string): Promise<number[]> {
	const q = query.trim().toLowerCase();
	if (!q) return [];
	const hit = keywordCache.get(q);
	if (hit) return hit;

	const data = await tmdb<{ results?: { id: number; name: string }[] }>('/search/keyword', {
		query: q
	});
	// Several ids, so "heist" also pulls "bank heist" and "art heist".
	const ids = (data.results ?? []).slice(0, 4).map((r) => r.id);
	keywordCache.set(q, ids);
	return ids;
}

export type MoodOptions = {
	keywords: number[];
	mediaType: 'tv' | 'movie';
	providers?: number[];
	minRating?: number;
};

export async function discoverByKeyword(opts: MoodOptions): Promise<TmdbResult[]> {
	const { keywords, mediaType, providers = [], minRating } = opts;
	if (!keywords.length) return [];

	const params: Record<string, string | number> = {
		with_keywords: keywords.join('|'), // OR, so related keywords widen the net
		sort_by: 'popularity.desc',
		include_adult: 'false',
		'vote_count.gte': 50 // keeps one-vote curiosities out of the results
	};
	if (minRating) params['vote_average.gte'] = minRating;
	if (providers.length) {
		params.with_watch_providers = providers.join('|');
		params.watch_region = 'US';
	}

	const cacheKey = `${mediaType}:${JSON.stringify(params)}`;
	const hit = discoverCache.get(cacheKey);
	if (hit) return hit;

	type Row = {
		id: number;
		name?: string;
		title?: string;
		poster_path: string | null;
		first_air_date?: string;
		release_date?: string;
		vote_average?: number;
	};
	const data = await tmdb<{ results?: Row[] }>(`/discover/${mediaType}`, params);

	const results = (data.results ?? []).map(
		(r): TmdbResult => ({
			mediaId: String(r.id),
			source: 'tmdb',
			mediaType,
			title: r.title ?? r.name ?? 'Untitled',
			poster: img(r.poster_path),
			year: yearOf(r.release_date ?? r.first_air_date),
			rating: typeof r.vote_average === 'number' ? Math.round(r.vote_average * 10) / 10 : null
		})
	);
	discoverCache.set(cacheKey, results);
	return results;
}

/** §6.2's preset chips. Ids are TMDB keyword ids, verified live. */
export const MOOD_PRESETS: { label: string; keywords: number[] }[] = [
	{ label: 'Heist', keywords: [10051, 191845, 250043] },
	{ label: 'Time travel', keywords: [4379] },
	{ label: 'Courtroom', keywords: [1904] },
	{ label: 'Whodunnit', keywords: [10714] },
	{ label: 'Workplace comedy', keywords: [11015] },
	{ label: 'Slow burn', keywords: [287501] }
];
