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
async function maxProgressFor(
	mediaType: MediaType,
	source: string,
	mediaId: string
): Promise<number | null> {
	/* A film is one thing; there is nothing to look up. This is not just an
	   optimisation — the lookup below is hardcoded to the tv path, so asking it
	   about a movie fetched whatever series happens to share that TMDB id and
	   returned its episode count. Plan 9 from Outer Space came back as "0/24". */
	if (mediaType === 'movie') return 1;

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
/**
 * TMDB lists the same service many times over: resale channels ("HBO Max Amazon
 * Channel"), ad tiers ("Netflix Standard with Ads") and plan tiers ("Paramount
 * Plus Premium", "Paramount Plus Essential"). Untouched that is 43 entries of
 * near-duplicates, which is unusable as a filter. Collapsing them to the service
 * you actually subscribe to gets it to roughly 20.
 */
const RESELLER = /\s+(?:Amazon Channel|Apple TV Channel|Roku Premium Channel|Channel)$/i;
const AD_TIER = /\s+(?:Standard |Basic )?with Ads$/i;
const PLAN_TIER = /\s+(?:Premium\+|Premium Plus|Premium|Essential|Standard|Basic|Plus)$/i;

export function normaliseService(name: string): string {
	let out = name.replace(RESELLER, '').replace(AD_TIER, '').trim();
	// "Paramount Plus" and "Paramount+" are the same thing; settle on the symbol
	// before stripping tiers, so "Paramount Plus Premium" does not become
	// "Paramount".
	out = out.replace(/\bPlus\b/g, '+').replace(/\s+\+/g, '+');
	out = out.replace(PLAN_TIER, '').trim();
	out = out.replace(/\+\s*\+/g, '+');
	return out;
}

/** Case-insensitive canonical form, so "BritBox" and "Britbox" are one entry. */
const canonical = new Map<string, string>();
function dedupeKey(name: string): string {
	const key = name.toLowerCase().replace(/[^a-z0-9+]/g, '');
	const seen = canonical.get(key);
	if (seen) return seen;
	canonical.set(key, name);
	return name;
}

function servicesOf(item: Record<string, unknown>): string[] {
	const providers = item.watch_providers;
	if (!providers || typeof providers !== 'object') return [];
	const us = (providers as Record<string, unknown>).US;
	if (!us || typeof us !== 'object') return [];

	const names = new Set<string>();
	// `flatrate` is subscription streaming; rent/buy are not "on a service I pay for".
	for (const entry of ((us as Record<string, unknown>).flatrate as unknown[]) ?? []) {
		const name = (entry as Record<string, unknown>)?.provider_name;
		if (typeof name === 'string') names.add(dedupeKey(normaliseService(name)));
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

/* Where you actually are in a show you started in the middle.
 *
 * `next_episode` is the LOWEST unwatched episode, which is only "next up" when
 * what you have watched is an unbroken run from the start. Pick a show up at
 * its current season — Below Deck Mediterranean, 31 episodes in across seasons
 * 10 and 11 — and Floppy points at S01E01 forever, however recently you
 * watched. Hobi did the same thing, so the row sat at the top of "recently
 * watched" describing an episode from 2016.
 *
 * Correcting this costs two requests, so it runs only for rows that are
 * provably wrong: 31 episodes watched and still "next: S01E01" cannot both be
 * true. A show genuinely at its first episode has progress 0 and is untouched.
 * The narrower case — a season skipped in the middle, where Floppy points at
 * the gap rather than the start — is left alone, since there the gap is a
 * defensible answer.
 */
type NextUp = { season: number; episode: number; airDate: string | null };
/* 'done' is not the same as null. Null means "no correction available, keep
   what Floppy said"; 'done' means the seasons you actually watch are finished,
   which is a real answer and renders as Caught up. */
type Correction = NextUp | 'done';
const nextUpCache = new TTLCache<Correction | null>(10 * 60 * 1000, 500);

function seasonNumberOf(entry: Record<string, unknown>): number | null {
	const item = (entry.item ?? {}) as Record<string, unknown>;
	const n = item.season_number;
	return typeof n === 'number' ? n : null;
}

async function nextUpFor(source: string, mediaId: string): Promise<Correction | null> {
	const key = `${source}:${mediaId}`;
	const hit = nextUpCache.get(key);
	if (hit !== undefined) return hit;

	try {
		const detail = await floppy<{ related?: { seasons?: Record<string, unknown>[] } }>(
			`/api/v1/media/tv/${source}/${encodeURIComponent(mediaId)}/`
		);

		/* The season you are actually watching: the most recently progressed one
		   that has any plays. Not the highest-numbered — a dip back into an old
		   season should not move next-up there. */
		const watched = (detail?.related?.seasons ?? []).filter(
			(sn) => typeof sn.progress === 'number' && sn.progress > 0
		);
		const current = watched.sort((a, b) =>
			String(b.progressed_at ?? '').localeCompare(String(a.progressed_at ?? ''))
		)[0];
		const seasons = (detail?.related?.seasons ?? []).filter((sn) => {
			const n = seasonNumberOf(sn);
			return n !== null && n > 0;
		});
		const seasonNumber = current ? seasonNumberOf(current) : null;
		if (seasonNumber === null) {
			nextUpCache.set(key, null);
			return null;
		}

		const season = await floppy<{ related?: { episodes?: Record<string, unknown>[] } }>(
			`/api/v1/media/tv/${source}/${encodeURIComponent(mediaId)}/${seasonNumber}/`
		);
		const episodes = (season?.related?.episodes ?? [])
			.map((e) => {
				const item = (e.item ?? {}) as Record<string, unknown>;
				return {
					number: typeof item.episode_number === 'number' ? item.episode_number : null,
					airDate: typeof item.release_datetime === 'string' ? item.release_datetime : null,
					played: typeof e.progress === 'number' && e.progress > 0
				};
			})
			.filter((e): e is { number: number; airDate: string | null; played: boolean } => e.number !== null)
			.sort((a, b) => a.number - b.number);

		/* After the last one you watched, not the first one you skipped. An
		   episode passed over mid-season is a decision, not a bookmark. */
		const lastPlayed = episodes.filter((e) => e.played).at(-1);
		const next = lastPlayed ? episodes.find((e) => e.number > lastPlayed.number && !e.played) : null;

		let out: Correction | null = next
			? { season: seasonNumber, episode: next.number, airDate: next.airDate }
			: null;

		/* Season finished. Roll into the next one you have not started; if there
		   is none, the show is done until it returns — which is the honest answer
		   even with old seasons unwatched, since those are a choice, not a
		   backlog. */
		if (!out && lastPlayed) {
			const upcoming = seasons
				.map((sn) => ({ number: seasonNumberOf(sn) as number, progress: Number(sn.progress ?? 0) }))
				.filter((sn) => sn.number > seasonNumber && sn.progress === 0)
				.sort((a, b) => a.number - b.number)[0];
			out = upcoming ? { season: upcoming.number, episode: 1, airDate: null } : 'done';
		}

		nextUpCache.set(key, out);
		return out;
	} catch {
		// Never fail a row over this; the uncorrected value still renders.
		return null;
	}
}

/** Fills in whatever the list row could not supply: episode title, and the
 *  episode total for season-scoped shows. Both lookups run concurrently. */
async function enrich(row: WatchlistRow): Promise<WatchlistRow> {
	if (!row.mediaId) return row;

	/* Floppy's next-up is the lowest unwatched episode, so a show picked up
	   mid-run reports S01E01 no matter how far in you are. Resolved before the
	   title lookup below, which would otherwise fetch the title of the wrong
	   episode. */
	if (row.mediaType !== 'movie' && row.progress > 0 && row.next?.season === 1 && row.next.episode === 1) {
		const corrected = await nextUpFor(row.source, row.mediaId);
		if (corrected === 'done') row = { ...row, next: null };
		else if (corrected) row = { ...row, next: corrected };
	}

	const [title, max] = await Promise.all([
		row.next
			? episodeTitle(row.source, row.mediaId, row.next.season, row.next.episode)
			: Promise.resolve(null),
		row.maxProgress === null
			? maxProgressFor(row.mediaType, row.source, row.mediaId)
			: Promise.resolve(row.maxProgress)
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

	/* Enrichment is the expensive part of a rebuild — up to 88 episode lookups.
	   Run in bounded batches rather than all at once so a rebuild leaves Floppy
	   slots free for whatever the user is doing at the same time. With
	   stale-while-revalidate nobody waits on this, so the extra wall time is
	   spent off the request path. */
	let rows: WatchlistRow[];
	if (shouldEnrich) {
		rows = [];
		const BATCH = 8;
		for (let i = 0; i < collected.length; i += BATCH) {
			rows.push(
				...(await Promise.all(
					collected.slice(i, i + BATCH).map((r) => enrich(mapRow(r, mediaType)))
				))
			);
		}
	} else {
		rows = collected.map((r) => mapRow(r, mediaType));
	}

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
