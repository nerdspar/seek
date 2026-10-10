import { json, error } from '@sveltejs/kit';
import { getRow } from '$lib/server/watchlist';
import { patch, expire, invalidate } from '$lib/server/memo';
import { alreadyApplied, markApplied } from '$lib/server/idempotency';
import type { WatchlistPage } from '$lib/server/watchlist';
import type { WatchlistRow } from '$lib/types';
import type { MediaType } from '$lib/types';
import { currentUser } from '$lib/server/userctx';
import { afterUnplay, recordPlay, removeNewestPlay, settleCompletion, tmdbIdOf, watchers } from '$lib/server/tracking/write';
import type { RequestHandler } from './$types';

/**
 * Fold a freshly-read row back into the cached watchlist without a rebuild.
 * In the in-progress backlog a row that is now caught up (no next episode) is
 * removed; everywhere else it is updated in place.
 */
function applyRowToWatchlist(row: WatchlistPage['rows'][number], source: string, mediaId: string) {
	const isRow = (r: WatchlistRow) => r.source === source && r.mediaId === mediaId;
	patch<WatchlistPage>('watchlist:', (page, key) => {
		const isBacklog = key.split(':')[3] === 'in_progress';
		if (isBacklog && row.next === null) {
			return { ...page, rows: page.rows.filter((r) => !isRow(r)) };
		}
		return { ...page, rows: page.rows.map((r) => (isRow(r) ? row : r)) };
	});
}

type Body = {
	source?: string;
	mediaId?: string;
	mediaType?: MediaType;
	title?: string;
	season?: number;
	episode?: number;
	/** When it was watched (ISO), for "Watched on…"; defaults to now. */
	at?: string;
};

function parse(body: Body) {
	const { source = 'tmdb', mediaId, season, episode, mediaType = 'tv', title = '', at } = body;
	if (!mediaId) error(400, 'mediaId is required');
	const isMovie = mediaType === 'movie';
	if (!isMovie && (typeof season !== 'number' || typeof episode !== 'number')) {
		// §12.2: mediaId is the SHOW's TMDB id.
		error(400, 'mediaId, season and episode are required');
	}
	const tmdbId = tmdbIdOf(source, mediaId);
	if (tmdbId === null) error(400, 'Only TMDB titles can be tracked');
	if (at !== undefined && (typeof at !== 'string' || Number.isNaN(Date.parse(at)) || Date.parse(at) > Date.now() + 60_000)) {
		error(400, 'at must be a date that has happened');
	}
	return {
		source,
		mediaId,
		tmdbId,
		kind: isMovie ? ('movie' as const) : ('tv' as const),
		season: isMovie ? null : (season as number),
		episode: isMovie ? null : (episode as number),
		mediaType,
		title,
		isMovie,
		at: at ? new Date(at).toISOString() : undefined
	};
}

/** Every detail/aggregate cache a play (or its undo) can move for this title. */
function bustWatchCaches(isMovie: boolean, mediaType: MediaType, source: string, mediaId: string, season: number | null) {
	expire('watchlist:');
	expire('library:');
	expire('stats:');
	expire('collection:');
	expire('upcoming');
	invalidate(`tracking:${mediaType}:${source}:${mediaId}`);
	if (isMovie) invalidate(`movie:${source}:${mediaId}`);
	else {
		invalidate(`show:${source}:${mediaId}`);
		invalidate(`season:${source}:${mediaId}:${season}`);
	}
}

async function respond(p: ReturnType<typeof parse>) {
	const row = await getRow(p.mediaType, p.source, p.mediaId, p.title).catch(() => null);
	if (row) applyRowToWatchlist(row, p.source, p.mediaId);
	bustWatchCaches(p.isMovie, p.mediaType, p.source, p.mediaId, p.season);
	return json({ ok: true, row });
}

/** Mark watched: one more play (§12.3), for everyone it counts for (a shared title). */
export const POST: RequestHandler = async ({ request }) => {
	const key = request.headers.get('Idempotency-Key');
	const p = parse(await request.json());
	const me = currentUser();
	if (!me) error(401);
	/* A POST appends, so a replayed request (the queue retrying one whose response
	   was lost) would record a second play. */
	if (!alreadyApplied(key)) {
		for (const id of watchers(me, p.source, p.mediaId, p.kind)) {
			recordPlay(id, p.kind, p.tmdbId, p.season, p.episode, p.at);
			if (p.kind === 'tv') settleCompletion(id, p.tmdbId);
		}
		markApplied(key);
	}
	return respond(p);
};

/** Undo (§4.3): the newest play of this episode or film, yours only. */
export const DELETE: RequestHandler = async ({ request }) => {
	const key = request.headers.get('Idempotency-Key');
	const p = parse(await request.json());
	const me = currentUser();
	if (!me) error(401);
	if (!alreadyApplied(key)) {
		removeNewestPlay(me.id, p.kind, p.tmdbId, p.season, p.episode);
		afterUnplay(me.id, p.kind, p.tmdbId, p.season, p.episode);
		markApplied(key);
	}
	return respond(p);
};
