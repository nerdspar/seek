import { json, error } from '@sveltejs/kit';
import { expire, invalidate } from '$lib/server/memo';
import { alreadyApplied, markApplied } from '$lib/server/idempotency';
import { currentUser } from '$lib/server/userctx';
import { afterUnplay, clearSeason, fillSeason, rewatchSeason, settleCompletion, tmdbIdOf, watchers } from '$lib/server/tracking/write';
import type { RequestHandler } from './$types';

type Body = {
	source?: string;
	mediaId?: string;
	season?: number;
	episodes?: number;
	watched?: number;
	/** Watched the whole season again: a play of every aired episode, watched or not. */
	rewatch?: boolean;
	/** When (ISO), for "Watched on…"; defaults to now. */
	at?: string;
};

/** Every cache a season-level watch change can move. */
function bustSeasonCaches(source: string, mediaId: string, season: number): void {
	expire('watchlist:');
	expire('library:');
	expire('stats:');
	expire('collection:');
	expire('upcoming');
	invalidate(`tracking:tv:${source}:${mediaId}`);
	invalidate(`show:${source}:${mediaId}`);
	invalidate(`season:${source}:${mediaId}:${season}`);
}

function parse(body: Body) {
	const { source = 'tmdb', mediaId, season } = body;
	if (!mediaId || typeof season !== 'number') error(400, 'mediaId and season are required');
	const tmdbId = tmdbIdOf(source, mediaId);
	if (tmdbId === null) error(400, 'Only TMDB titles can be tracked');
	const me = currentUser();
	if (!me) error(401);
	return { source, mediaId, season, tmdbId, me };
}

/** Mark a whole season watched: every aired episode in it you haven't seen —
 *  or, with `rewatch`, every aired episode again. */
export const POST: RequestHandler = async ({ request }) => {
	const key = request.headers.get('Idempotency-Key');
	const body = (await request.json()) as Body;
	const { source, mediaId, season, tmdbId, me } = parse(body);
	if (body.at !== undefined && (typeof body.at !== 'string' || Number.isNaN(Date.parse(body.at)) || Date.parse(body.at) > Date.now() + 60_000)) {
		error(400, 'at must be a date that has happened');
	}
	const at = body.at ? new Date(body.at).toISOString() : undefined;
	if (alreadyApplied(key)) return json({ ok: true, marked: 0, replay: true });
	let marked = 0;
	for (const id of watchers(me, source, mediaId, 'tv')) {
		const n = body.rewatch ? rewatchSeason(id, tmdbId, season, at) : fillSeason(id, tmdbId, season, Number.MAX_SAFE_INTEGER, Date.now(), at);
		if (id === me.id) marked = n;
		settleCompletion(id, tmdbId);
	}
	markApplied(key);
	bustSeasonCaches(source, mediaId, season);
	return json({ ok: true, marked });
};

/** Clear a whole season: every play in it, yours only. */
export const DELETE: RequestHandler = async ({ request }) => {
	const { source, mediaId, season, tmdbId, me } = parse((await request.json()) as Body);
	clearSeason(me.id, tmdbId, season);
	afterUnplay(me.id, 'tv', tmdbId, season, null);
	bustSeasonCaches(source, mediaId, season);
	return json({ ok: true });
};
