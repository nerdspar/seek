/**
 * Builds the watchlist rows (spec §4.1) from Floppy's list response.
 *
 * Field notes, all verified live against v26.8.20 rather than assumed:
 *
 * - `max_progress` is NOT on the list response. The show's total episode count
 *   arrives as `item.number_of_pages` — an overloaded field name (it means what
 *   it says for books), but it agrees exactly with `max_progress` on the show
 *   detail endpoint. Using it avoids an N+1 call per row.
 *
 * - `next_episode.title` is NOT reliably the episode title. It is sometimes the
 *   SHOW title (Outer Banks S05E01 reports "Outer Banks", not "The Crossing").
 *   §4.1 wants the real episode title on the pill, so it comes from the episode
 *   detail endpoint and is cached — episode titles never change once aired.
 *
 * - `next_episode` is ONLY on the list endpoint. Show detail does not carry it,
 *   and neither does the watch POST response — see getRow().
 *
 * - §12.4: season/episode numbering comes from `next_episode` and is never
 *   computed. Absolute-numbered shows (Re:ZERO) only work because of this.
 *
 * - `sort` is a closed enum and Floppy 400s on anything outside it. There is no
 *   `progressed_at` despite the field existing on the response; `updated` is
 *   what backs §4.5's "Recently watched".
 */
import { floppy } from './floppy';
import { TTLCache } from './cache';
import { companyQuery, type Company } from './tags';
import type { MediaType, TrackedMedia, WatchlistRow } from '$lib/types';

type ListResponse = {
	pagination: { total: number; limit: number; offset: number; next: string | null };
	results: TrackedMedia[];
};

/** Episode titles are immutable once aired; a long TTL is safe. */
const titleCache = new TTLCache<string | null>(24 * 60 * 60 * 1000, 5000);

/** Episode totals do change as shows air, so this expires far sooner. */
const maxProgressCache = new TTLCache<number | null>(6 * 60 * 60 * 1000, 2000);

/**
 * Recover a show's episode total when the list row omits it.
 *
 * Shows tracked with season-scoped progress come back with
 * `item.number_of_pages: null` — 25 of 88 rows in this library (Big Sky,
 * Peacemaker, Shameless…). They are ordinary shows with a valid `next_episode`,
 * not season fragments and not duplicates of anything else in the list, so they
 * must not be filtered out. Without a total they would render an empty progress
 * bar and no "N left", which is most of what the row is for.
 *
 * Show detail carries `max_progress` for every one of them, so this fills the
 * gap. It is an extra call per affected row on first load only, then cached.
 */
async function maxProgressFor(source: string, mediaId: string): Promise<number | null> {
	const key = `${source}:${mediaId}`;
	const hit = maxProgressCache.get(key);
	if (hit !== undefined) return hit;

	try {
		const detail = await floppy<{ max_progress: number | null }>(
			`/api/v1/media/tv/${source}/${encodeURIComponent(mediaId)}/`
		);
		const max = typeof detail?.max_progress === 'number' ? detail.max_progress : null;
		maxProgressCache.set(key, max);
		return max;
	} catch {
		return null;
	}
}

export async function episodeTitle(
	source: string,
	mediaId: string,
	season: number,
	episode: number
): Promise<string | null> {
	const key = `${source}:${mediaId}:${season}:${episode}`;
	const hit = titleCache.get(key);
	if (hit !== undefined) return hit;

	try {
		const ep = await floppy<{ title: string | null }>(
			`/api/v1/media/tv/${source}/${encodeURIComponent(mediaId)}/${season}/${episode}/`
		);
		const title = ep?.title ?? null;
		titleCache.set(key, title);
		return title;
	} catch {
		// A missing title must never fail the row — the pill degrades to "S05E01".
		return null;
	}
}

/**
 * Streaming services a title is on, from TMDB data Floppy already carries.
 *
 * Floppy's own `platform[]` filter is a no-op — passing any value returns the
 * whole library — and `item.platforms` is empty on every row here. The real
 * provider data lives under `item.watch_providers`, keyed by region, so service
 * filtering happens in Seek rather than on the server.
 */
function servicesOf(item: Record<string, unknown>): string[] {
	const providers = item.watch_providers;
	if (!providers || typeof providers !== 'object') return [];
	const us = (providers as Record<string, unknown>).US;
	if (!us || typeof us !== 'object') return [];

	const names = new Set<string>();
	// `flatrate` is subscription streaming; rent/buy are not "on a service I pay for".
	for (const entry of ((us as Record<string, unknown>).flatrate as unknown[]) ?? []) {
		const name = (entry as Record<string, unknown>)?.provider_name;
		if (typeof name === 'string') names.add(name);
	}
	return [...names];
}

function mapRow(r: TrackedMedia, mediaType: MediaType): WatchlistRow {
	const item = (r.item ?? {}) as Record<string, unknown>;
	const ne = r.next_episode;
	const max = typeof item.number_of_pages === 'number' ? item.number_of_pages : null;
	const progress = r.progress ?? 0;

	return {
		mediaId: String(item.media_id ?? ''),
		source: String(item.source ?? 'tmdb'),
		mediaType,
		title: String(item.title ?? 'Untitled'),
		poster: (item.image as string) ?? null,
		services: servicesOf(item),
		next:
			ne && ne.season_number !== null
				? { season: ne.season_number, episode: ne.episode_number, airDate: ne.air_date }
				: null,
		progress,
		maxProgress: max,
		left: max === null ? null : Math.max(0, max - progress)
	};
}

/** Fills in whatever the list row could not supply: episode title, and the
 *  episode total for season-scoped shows. Both lookups run concurrently. */
async function enrich(row: WatchlistRow): Promise<WatchlistRow> {
	if (!row.mediaId) return row;

	const [title, max] = await Promise.all([
		row.next
			? episodeTitle(row.source, row.mediaId, row.next.season, row.next.episode)
			: Promise.resolve(null),
		row.maxProgress === null ? maxProgressFor(row.source, row.mediaId) : Promise.resolve(row.maxProgress)
	]);

	const out: WatchlistRow = { ...row };
	if (title && out.next) out.next = { ...out.next, title };
	if (max !== null && out.maxProgress === null) {
		out.maxProgress = max;
		out.left = Math.max(0, max - out.progress);
	}
	return out;
}

export type WatchlistPage = { rows: WatchlistRow[]; total: number; hasMore: boolean };

export type WatchlistOptions = {
	sort?: string;
	direction?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
	/** User tracking status; defaults to the in-progress backlog (§4.1). */
	statuses?: string[];
	/** Solo / Joint / All (§11). */
	company?: Company;
	/** Subscription services to keep. Applied in Seek — see servicesOf. */
	services?: string[];
	/** Page past Floppy's 200-row ceiling to fetch the whole list. */
	all?: boolean;
	/** Resolve next-episode titles and missing episode counts. The library grid
	 *  shows neither, and skipping it avoids one lookup per row. */
	enrich?: boolean;
};

export async function getWatchlist(
	mediaType: MediaType,
	{
		sort = 'updated',
		direction = 'desc',
		limit = 200,
		offset = 0,
		statuses = ['in_progress'],
		company = 'all',
		services = [],
		all = false,
		enrich: shouldEnrich = true
	}: WatchlistOptions = {}
): Promise<WatchlistPage> {
	// `not_caught_up` only makes sense for the in-progress backlog; asking for
	// Completed and then filtering to "has an unwatched episode" returns nothing.
	const onlyInProgress = statuses.length === 1 && statuses[0] === 'in_progress';

	const page = (o: number) =>
		floppy<ListResponse>(`/api/v1/media/${mediaType}/`, {
			query: {
				status: statuses,
				progress: onlyInProgress ? 'not_caught_up' : undefined,
				sort,
				direction,
				limit,
				offset: o,
				...companyQuery(company)
			},
			// ~1.2s warm, but slower while Floppy is serving a statistics query.
			timeoutMs: 45_000
		});

	const res = await page(offset);
	const collected = [...(res.results ?? [])];

	// Floppy caps `limit` at 200, so a larger library needs paging — otherwise the
	// header reports 370 titles above a grid of 200.
	if (all) {
		const total = res.pagination?.total ?? collected.length;
		for (let o = offset + limit; collected.length < total && o < total; o += limit) {
			const next = await page(o);
			const rows = next.results ?? [];
			if (!rows.length) break;
			collected.push(...rows);
		}
	}

	// Titles resolve in parallel; one slow lookup does not hold up the page.
	let rows = shouldEnrich
		? await Promise.all(collected.map((r) => enrich(mapRow(r, mediaType))))
		: collected.map((r) => mapRow(r, mediaType));

	if (services.length) {
		const wanted = new Set(services);
		rows = rows.filter((row) => row.services.some((s) => wanted.has(s)));
	}

	const p = res.pagination;
	return {
		rows,
		total: services.length || all ? rows.length : (p?.total ?? rows.length),
		hasMore: !all && Boolean(p?.next)
	};
}

/** Every subscription service seen across the library, for the filter and the
 *  settings picker. Cached — provider data moves slowly. */
const servicesCache = new TTLCache<string[]>(6 * 60 * 60 * 1000, 4);

export async function knownServices(): Promise<string[]> {
	const hit = servicesCache.get('all');
	if (hit) return hit;

	const found = new Map<string, number>();
	for (const mediaType of ['tv', 'movie'] as const) {
		try {
			const res = await floppy<ListResponse>(`/api/v1/media/${mediaType}/`, {
				query: { status: ['all'], limit: 200 },
				timeoutMs: 60_000
			});
			for (const r of res.results ?? []) {
				for (const name of servicesOf((r.item ?? {}) as Record<string, unknown>)) {
					found.set(name, (found.get(name) ?? 0) + 1);
				}
			}
		} catch {
			// A partial list is better than none.
		}
	}

	// Commonest first — the household's actual services float to the top.
	const names = [...found.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
	servicesCache.set('all', names);
	return names;
}

/**
 * Re-read one show's row after a write (§4.2's background row refresh).
 *
 * This exists because there is no single-item route that returns `next_episode`:
 * show detail omits it, and the watch POST responds about the EPISODE it just
 * recorded (`item_media_type: "episode"`, `progress: 1` meaning one play of that
 * episode) — not about the show. The list endpoint is the only source.
 *
 * The list has no id filter, so it is narrowed by `search` and then matched on
 * media_id: `search` is a title substring match and genuinely returns several
 * shows ("Below Deck" matches three), so taking the first hit would silently
 * write the wrong show's state into the row.
 *
 * `progress: 'all'` matters — once the show is caught up it drops out of a
 * `not_caught_up` query, and an absent row is indistinguishable from an error.
 */
export async function getRow(
	mediaType: MediaType,
	source: string,
	mediaId: string,
	title: string
): Promise<WatchlistRow | null> {
	const res = await floppy<ListResponse>(`/api/v1/media/${mediaType}/`, {
		query: { status: ['all'], progress: 'all', search: title, limit: 50 }
	});

	const hit = (res.results ?? []).find(
		(r) =>
			String((r.item as Record<string, unknown>)?.media_id ?? '') === String(mediaId) &&
			String((r.item as Record<string, unknown>)?.source ?? '') === source
	);
	if (!hit) return null;

	return enrich(mapRow(hit, mediaType));
}
