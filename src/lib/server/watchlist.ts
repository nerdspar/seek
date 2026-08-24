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
import type { MediaType, TrackedMedia, WatchlistRow } from '$lib/types';

type ListResponse = {
	pagination: { total: number; limit: number; offset: number; next: string | null };
	results: TrackedMedia[];
};

/** Episode titles are immutable once aired; a long TTL is safe. */
const titleCache = new TTLCache<string | null>(24 * 60 * 60 * 1000, 5000);

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
		next:
			ne && ne.season_number !== null
				? { season: ne.season_number, episode: ne.episode_number, airDate: ne.air_date }
				: null,
		progress,
		maxProgress: max,
		left: max === null ? null : Math.max(0, max - progress)
	};
}

async function withEpisodeTitle(row: WatchlistRow): Promise<WatchlistRow> {
	if (!row.next || !row.mediaId) return row;
	const title = await episodeTitle(row.source, row.mediaId, row.next.season, row.next.episode);
	return title ? { ...row, next: { ...row.next, title } } : row;
}

export type WatchlistPage = { rows: WatchlistRow[]; total: number; hasMore: boolean };

export async function getWatchlist(
	mediaType: MediaType,
	{ sort = 'updated', direction = 'desc' as 'asc' | 'desc', limit = 20, offset = 0 } = {}
): Promise<WatchlistPage> {
	const res = await floppy<ListResponse>(`/api/v1/media/${mediaType}/`, {
		query: {
			status: ['in_progress'],
			progress: 'not_caught_up',
			sort,
			direction,
			limit,
			offset
		}
	});

	// Titles resolve in parallel; one slow lookup does not hold up the page.
	const rows = await Promise.all((res.results ?? []).map((r) => withEpisodeTitle(mapRow(r, mediaType))));

	const p = res.pagination;
	return { rows, total: p?.total ?? rows.length, hasMore: Boolean(p?.next) };
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

	return withEpisodeTitle(mapRow(hit, mediaType));
}
