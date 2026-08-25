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

/**
 * §6.2's preset chips — the point is to be usable without knowing what to type,
 * so these cover the shapes people actually ask for rather than a tidy taxonomy.
 * Ids are TMDB keyword ids; several presets OR a few together because TMDB
 * splits near-synonyms ("heist", "bank heist", "art heist").
 */
export const MOOD_PRESETS: { label: string; keywords: number[] }[] = [
	{ label: 'Heist', keywords: [10051, 191845, 250043] },
	{ label: 'Whodunnit', keywords: [10714, 9951] },
	{ label: 'Time travel', keywords: [4379, 4565] },
	{ label: 'Courtroom', keywords: [1904, 717] },
	{ label: 'Workplace comedy', keywords: [11015, 18023] },
	{ label: 'Slow burn', keywords: [287501] },
	{ label: 'Small town', keywords: [10183, 1462] },
	{ label: 'Con artists', keywords: [10714, 6270] },
	{ label: 'Survival', keywords: [10349, 12616] },
	{ label: 'Space', keywords: [9882, 14544] },
	{ label: 'Post-apocalyptic', keywords: [4458, 1721] },
	{ label: 'Spy', keywords: [10391, 470] },
	{ label: 'Period drama', keywords: [10683, 4344] },
	{ label: 'Found family', keywords: [255201] },
	{ label: 'Dark comedy', keywords: [9673, 15351] },
	{ label: 'True crime', keywords: [11800, 5565] },
	{ label: 'Medical', keywords: [11342, 3308] },
	{ label: 'Competition', keywords: [7312, 18035] }
];

export type ShowExtras = {
	/** Broadcast networks (The WB, AMC) — what a show "airs on". */
	networks: { name: string; logo: string | null }[];
	/** US subscription services it streams on now. */
	services: { name: string; logo: string | null }[];
	similar: TmdbResult[];
};

const extrasCache = new TTLCache<ShowExtras>(24 * 60 * 60 * 1000, 500);

/**
 * Networks, streaming services and similar shows in one TMDB call.
 *
 * Floppy carries none of this at show level: its show detail exposes only
 * `details.studios` (production companies, not networks) and no recommendations
 * — those live on *season* detail. One append_to_response call is cheaper and
 * more honest than stitching those together.
 */
export async function getShowExtras(mediaId: string): Promise<ShowExtras> {
	const empty: ShowExtras = { networks: [], services: [], similar: [] };
	if (!TMDB_API_KEY()) return empty;

	const hit = extrasCache.get(mediaId);
	if (hit) return hit;

	type Row = { id: number; name?: string; poster_path: string | null; first_air_date?: string; vote_average?: number };
	type Provider = { provider_name: string; logo_path: string | null };

	try {
		const data = await tmdb<{
			networks?: { name: string; logo_path: string | null }[];
			recommendations?: { results?: Row[] };
			'watch/providers'?: { results?: Record<string, { flatrate?: Provider[] }> };
		}>(`/tv/${encodeURIComponent(mediaId)}`, {
			append_to_response: 'recommendations,watch/providers'
		});

		const seen = new Set<string>();
		const services: { name: string; logo: string | null }[] = [];
		for (const p of data['watch/providers']?.results?.US?.flatrate ?? []) {
			const name = normaliseServiceName(p.provider_name);
			if (seen.has(name)) continue;
			seen.add(name);
			services.push({ name, logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null });
		}

		const extras: ShowExtras = {
			networks: (data.networks ?? []).map((n) => ({
				name: n.name,
				logo: n.logo_path ? `https://image.tmdb.org/t/p/w92${n.logo_path}` : null
			})),
			services,
			similar: (data.recommendations?.results ?? []).slice(0, 12).map((r) => ({
				mediaId: String(r.id),
				source: 'tmdb' as const,
				mediaType: 'tv' as const,
				title: r.name ?? 'Untitled',
				poster: img(r.poster_path),
				year: yearOf(r.first_air_date),
				rating: typeof r.vote_average === 'number' ? Math.round(r.vote_average * 10) / 10 : null
			}))
		};

		extrasCache.set(mediaId, extras);
		return extras;
	} catch {
		// Extras are decoration; the show page must render without them.
		return empty;
	}
}

/** Mirrors the watchlist's collapsing of TMDB's duplicate provider entries. */
function normaliseServiceName(name: string): string {
	return name
		.replace(/\s+(?:Amazon Channel|Apple TV Channel|Roku Premium Channel|Channel)$/i, '')
		.replace(/\s+(?:Standard |Basic )?with Ads$/i, '')
		.replace(/\bPlus\b/g, '+')
		.replace(/\s+\+/g, '+')
		.replace(/\s+(?:Premium\+|Premium Plus|Premium|Essential|Standard|Basic|Plus)$/i, '')
		.trim();
}
