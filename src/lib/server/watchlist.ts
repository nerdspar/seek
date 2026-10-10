/**
 * The watchlist and library lists (spec §4.1), from Seek's own data (own-tracking
 * plan): what you track and have watched lives in Seek's tables, show info in
 * Seek's TMDB copy. Same exports and shapes the screens have always used.
 */
import { db } from './db';
import { currentUser } from './userctx';
import { seekList, seekRows } from './tracking/read';
import { normaliseService, serviceNames } from './serviceNames';
import type { MediaType, WatchlistRow } from '$lib/types';

export { normaliseService, serviceNames };

export type WatchlistPage = { rows: WatchlistRow[]; total: number; hasMore: boolean };

export type WatchlistOptions = {
	sort?: string;
	direction?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
	/** Tracking status; defaults to the in-progress backlog (§4.1). */
	statuses?: string[];
	/** Solo / Joint / All (§11). */
	company?: 'all' | 'joint' | 'solo';
	/** 'anime' or 'joint'; `tagMode: 'not'` inverts it. Takes precedence over `company`. */
	tag?: string;
	tagMode?: 'not';
	/** Subscription services to keep. */
	services?: string[];
	/** The whole list rather than one page. */
	all?: boolean;
	/** Kept for callers; Seek always has next-up titles and counts to hand. */
	enrich?: boolean;
};

const empty: WatchlistPage = { rows: [], total: 0, hasMore: false };

export async function getWatchlist(
	mediaType: MediaType,
	{ sort = 'updated', direction = 'desc', limit = 200, offset = 0, statuses = ['in_progress'], company = 'all', tag, tagMode, services = [], all = false }: WatchlistOptions = {}
): Promise<WatchlistPage> {
	const me = currentUser();
	if (!me) return empty;
	// "Anime" as a type is shows with the anime flag.
	const animeType = mediaType === 'anime' && !tag;
	const page = seekList(me.id, me.householdId, mediaType === 'movie' ? 'movie' : 'tv', {
		statuses,
		sort,
		direction,
		company,
		tag: animeType ? 'anime' : tag,
		tagMode: animeType ? undefined : tagMode,
		services
	});
	if (all) return page;
	const rows = page.rows.slice(offset, offset + limit);
	return { rows, total: page.total, hasMore: offset + limit < page.total };
}

/** One row, for re-rendering it after a change. */
export async function getRow(mediaType: MediaType, _source: string, mediaId: string, _title?: string): Promise<WatchlistRow | null> {
	const me = currentUser();
	if (!me) return null;
	return seekRows(me.id, me.householdId, mediaType === 'movie' ? 'movie' : 'tv').find((r) => r.mediaId === String(mediaId)) ?? null;
}

/** An episode's title, from Seek's TMDB copy. */
export async function episodeTitle(_source: string, mediaId: string, season: number, episode: number): Promise<string | null> {
	const r = db().prepare('SELECT title FROM episodes WHERE tmdb_id = ? AND season = ? AND episode = ?').get(Number(mediaId), season, episode) as
		| { title: string | null }
		| undefined;
	return r?.title ?? null;
}

/** Every subscription service across what you track, for the filter. */
export async function knownServices(): Promise<string[]> {
	const me = currentUser();
	if (!me) return [];
	const raw = (
		db()
			.prepare('SELECT t.services FROM tracked k JOIN titles t ON t.media_type = k.media_type AND t.tmdb_id = k.tmdb_id WHERE k.user_id = ?')
			.all(me.id) as { services: string }[]
	).flatMap((r) => {
		try {
			return JSON.parse(r.services) as string[];
		} catch {
			return [];
		}
	});
	return serviceNames(raw).sort((a, b) => a.localeCompare(b));
}

export type RecentAddition = {
	mediaType: MediaType;
	source: string;
	mediaId: string;
	title: string;
	poster: string | null;
	/** When it was added to your list. */
	addedAt: string;
};

/** The titles you added most recently, shows and films together. */
export async function getRecentlyAdded(limit = 12): Promise<RecentAddition[]> {
	const me = currentUser();
	if (!me) return [];
	return (
		db()
			.prepare(
				`SELECT k.media_type, k.tmdb_id, k.added_at, t.title, t.poster FROM tracked k
				LEFT JOIN titles t ON t.media_type = k.media_type AND t.tmdb_id = k.tmdb_id
				WHERE k.user_id = ? ORDER BY k.added_at DESC LIMIT ?`
			)
			.all(me.id, limit) as { media_type: MediaType; tmdb_id: number; added_at: string; title: string | null; poster: string | null }[]
	).map((r) => ({ mediaType: r.media_type, source: 'tmdb', mediaId: String(r.tmdb_id), title: r.title || 'Untitled', poster: r.poster, addedAt: r.added_at }));
}
