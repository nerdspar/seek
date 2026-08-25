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

/** Curated ids for the built-in labels; anything else resolves by search. */
export function keywordsForLabel(label: string): number[] | null {
	const preset = MOOD_PRESETS.find((p) => p.label.toLowerCase() === label.trim().toLowerCase());
	return preset ? preset.keywords : null;
}

export const DEFAULT_PRESET_LABELS = () => MOOD_PRESETS.map((p) => p.label);

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

/**
 * Live-TV bundles carry hundreds of channels, so listing them as "where to
 * watch" is noise: fuboTV is the answer for almost everything currently airing,
 * which makes it the answer for nothing. They are equally useless as a browse
 * target — "trending on fuboTV" is just trending.
 */
const LIVE_TV_CARRIERS = new Set([
	'fuboTV',
	'Fubo TV',
	'YouTube TV',
	'Hulu Live TV',
	'Sling TV',
	'DirecTV',
	'DIRECTV',
	'Philo',
	'Spectrum On Demand',
	'Xfinity'
]);


export type Provider = { id: number; name: string; logo: string | null; priority: number };

const providerCache = new TTLCache<Provider[]>(7 * 24 * 60 * 60 * 1000, 4);

/**
 * US watch providers, for discovering by streaming service.
 *
 * TMDB lists every resale and tier variant as its own provider — "HBO Max",
 * "HBO Max Amazon Channel", "Netflix Standard with Ads" — which would turn a
 * service picker into 46 near-duplicate chips. Collapsed to one entry per real
 * service, preferring the canonical listing: the one whose raw name survives
 * normalisation unchanged, then lowest display priority.
 */
export async function getProviders(): Promise<Provider[]> {
	const hit = providerCache.get('us');
	if (hit) return hit;
	if (!TMDB_API_KEY()) return [];

	try {
		const data = await tmdb<{
			results?: {
				provider_id: number;
				provider_name: string;
				logo_path: string | null;
				display_priority: number;
			}[];
		}>('/watch/providers/tv', { watch_region: 'US' });

		type Candidate = Provider & { raw: string };
		const best = new Map<string, Candidate>();

		for (const p of data.results ?? []) {
			const name = normaliseServiceName(p.provider_name);
			if (!name || LIVE_TV_CARRIERS.has(name)) continue;

			const candidate: Candidate = {
				id: p.provider_id,
				name,
				logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null,
				priority: p.display_priority ?? 999,
				raw: p.provider_name
			};

			const existing = best.get(name.toLowerCase());
			if (!existing) {
				best.set(name.toLowerCase(), candidate);
				continue;
			}
			// Prefer the entry TMDB names canonically, then the one it ranks highest.
			const canonical = (c: Candidate) => (c.raw === c.name ? 0 : 1);
			const beatsExisting =
				canonical(candidate) < canonical(existing) ||
				(canonical(candidate) === canonical(existing) && candidate.priority < existing.priority);
			if (beatsExisting) best.set(name.toLowerCase(), candidate);
		}

		const providers = [...best.values()]
			.map(({ raw: _raw, ...rest }) => rest)
			.sort((a, b) => a.priority - b.priority);
		providerCache.set('us', providers);
		return providers;
	} catch {
		return [];
	}
}

export type ProviderMode = 'trending' | 'new';

const providerRowCache = new TTLCache<TmdbResult[]>(6 * 60 * 60 * 1000, 200);

/**
 * What is popular, or newly arrived, on one service.
 *
 * "New" is bounded to the last 90 days and sorted by air date; without the
 * window TMDB happily returns things dated years ahead. Vote thresholds differ
 * by mode on purpose — a brand new title has not accumulated votes yet, so
 * demanding them would empty the row.
 */
export async function discoverByProvider(
	providerId: number,
	mediaType: 'tv' | 'movie',
	mode: ProviderMode
): Promise<TmdbResult[]> {
	if (!TMDB_API_KEY()) return [];

	const key = `${providerId}:${mediaType}:${mode}`;
	const hit = providerRowCache.get(key);
	if (hit) return hit;

	const today = new Date();
	const from = new Date(today.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
	const to = today.toISOString().slice(0, 10);
	const dateField = mediaType === 'tv' ? 'first_air_date' : 'primary_release_date';

	const params: Record<string, string | number> = {
		with_watch_providers: providerId,
		watch_region: 'US',
		include_adult: 'false',
		...(mode === 'trending'
			? { sort_by: 'popularity.desc', 'vote_count.gte': 20 }
			: {
					sort_by: `${dateField}.desc`,
					[`${dateField}.gte`]: from,
					[`${dateField}.lte`]: to,
					'vote_count.gte': 3
				})
	};

	type Row = {
		id: number;
		name?: string;
		title?: string;
		poster_path: string | null;
		first_air_date?: string;
		release_date?: string;
		vote_average?: number;
	};

	try {
		const data = await tmdb<{ results?: Row[] }>(`/discover/${mediaType}`, params);
		const results = (data.results ?? []).slice(0, 18).map(
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
		providerRowCache.set(key, results);
		return results;
	} catch {
		return [];
	}
}

export type ShowExtras = {
	/** Broadcast networks (The WB, AMC) — what a show "airs on". */
	networks: { name: string; logo: string | null }[];
	/** US subscription services it streams on now. */
	services: { name: string; logo: string | null }[];
	similar: TmdbResult[];
	/**
	 * Episode count per season number.
	 *
	 * This is the same data Floppy exposes as `max_progress` on each season, but
	 * getting it from Floppy costs one request per season — measured at 869ms for
	 * an eight-season show, which was most of the show page's load time. TMDB
	 * returns all of them inside the call this function already makes.
	 */
	seasonEpisodes: Record<number, number>;
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
	const empty: ShowExtras = { networks: [], services: [], similar: [], seasonEpisodes: {} };
	if (!TMDB_API_KEY()) return empty;

	const hit = extrasCache.get(mediaId);
	if (hit) return hit;

	type Row = { id: number; name?: string; poster_path: string | null; first_air_date?: string; vote_average?: number };
	type Provider = { provider_name: string; logo_path: string | null };

	try {
		const data = await tmdb<{
			networks?: { name: string; logo_path: string | null }[];
			seasons?: { season_number: number; episode_count: number }[];
			recommendations?: { results?: Row[] };
			'watch/providers'?: { results?: Record<string, { flatrate?: Provider[] }> };
		}>(`/tv/${encodeURIComponent(mediaId)}`, {
			append_to_response: 'recommendations,watch/providers'
		});

		const seen = new Set<string>();
		const services: { name: string; logo: string | null }[] = [];
		for (const p of data['watch/providers']?.results?.US?.flatrate ?? []) {
			const name = normaliseServiceName(p.provider_name);
			if (seen.has(name) || LIVE_TV_CARRIERS.has(name)) continue;
			seen.add(name);
			services.push({ name, logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null });
		}

		const extras: ShowExtras = {
			networks: (data.networks ?? []).map((n) => ({
				name: n.name,
				logo: n.logo_path ? `https://image.tmdb.org/t/p/w92${n.logo_path}` : null
			})),
			services,
			seasonEpisodes: Object.fromEntries(
				(data.seasons ?? [])
					.filter((s) => typeof s.season_number === 'number' && typeof s.episode_count === 'number')
					.map((s) => [s.season_number, s.episode_count])
			),
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
