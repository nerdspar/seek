import { json, error } from '@sveltejs/kit';
import { SCORE_MIN, SCORE_MAX, trackingKey } from '$lib/server/tracking';
import { expire, invalidate } from '$lib/server/memo';
import { Status } from '$lib/types';
import type { MediaType } from '$lib/types';
import { currentUser } from '$lib/server/userctx';
import { recordPlay, setTracked, Status as Tracked, tmdbIdOf } from '$lib/server/tracking/write';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

type Body = {
	mediaType?: MediaType;
	source?: string;
	mediaId?: string;
	status?: number;
	score?: number | null;
};

const VALID_STATUS = new Set<number>(Object.values(Status));

/** Set a title's status and/or your score for it. */
export const PATCH: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as Body | null;
	if (!body) error(400, 'Body must be JSON.');

	const { mediaType = 'tv', source = 'tmdb', mediaId, status, score } = body;
	if (!mediaId) error(400, 'mediaId is required');
	const tmdbId = tmdbIdOf(source, mediaId);
	if (tmdbId === null) error(400, 'Only TMDB titles can be tracked');
	const me = currentUser();
	if (!me) error(401);

	if (status !== undefined && !VALID_STATUS.has(status)) error(400, `Unknown status ${status}.`);
	if (score !== undefined && score !== null) {
		if (typeof score !== 'number' || Number.isNaN(score)) error(400, 'score must be a number.');
		if (score < SCORE_MIN || score > SCORE_MAX) {
			error(400, `score must be between ${SCORE_MIN} and ${SCORE_MAX}.`);
		}
	}

	const kind = mediaType === 'movie' ? 'movie' : 'tv';
	setTracked(me.id, kind, tmdbId, { status, score });
	// A film set Completed has been watched: it gets a play if it has none.
	if (kind === 'movie' && status === Tracked.Completed) {
		const has = db().prepare("SELECT 1 FROM plays WHERE user_id = ? AND media_type = 'movie' AND tmdb_id = ?").get(me.id, tmdbId);
		if (!has) recordPlay(me.id, 'movie', tmdbId, null, null);
	}

	/* Status decides which watchlist filter a title falls under, so the lists
	   move with it. */
	invalidate(trackingKey(mediaType, source, mediaId));
	invalidate(`${kind === 'movie' ? 'movie' : 'show'}:${source}:${mediaId}`);
	expire('watchlist:');
	expire('library:');
	expire('collection:');
	expire('stats:');

	return json({ ok: true });
};
