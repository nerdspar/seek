import { json, error } from '@sveltejs/kit';
import { setTracking, SCORE_MIN, SCORE_MAX, trackingKey } from '$lib/server/tracking';
import { FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import { expire, invalidate } from '$lib/server/memo';
import { Status } from '$lib/types';
import type { MediaType } from '$lib/types';
import type { RequestHandler } from './$types';

type Body = {
	mediaType?: MediaType;
	source?: string;
	mediaId?: string;
	status?: number;
	score?: number | null;
};

const VALID_STATUS = new Set<number>(Object.values(Status));

/** Set a show's status and/or your score for it. */
export const PATCH: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as Body | null;
	if (!body) error(400, 'Body must be JSON.');

	const { mediaType = 'tv', source = 'tmdb', mediaId, status, score } = body;
	if (!mediaId) error(400, 'mediaId is required');

	/* Checked here rather than left to Floppy. Floppy answers an out-of-range
	   score with a bare 400 "Invalid" that says nothing useful, and an
	   unrecognised status would otherwise be written as-is. */
	if (status !== undefined && !VALID_STATUS.has(status)) error(400, `Unknown status ${status}.`);
	if (score !== undefined && score !== null) {
		if (typeof score !== 'number' || Number.isNaN(score)) error(400, 'score must be a number.');
		if (score < SCORE_MIN || score > SCORE_MAX) {
			error(400, `score must be between ${SCORE_MIN} and ${SCORE_MAX}.`);
		}
	}

	try {
		await setTracking(mediaType, source, mediaId, { status, score });
	} catch (err) {
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable; nothing was changed.');
		if (err instanceof FloppyError) error(502, err.message);
		throw err;
	}

	/* Status decides which watchlist filter a show falls under, so the lists
	   move with it. Invalidated rather than expired: a stale read here shows the
	   status you just changed away from, which is the whole point of changing it. */
	invalidate(trackingKey(mediaType, source, mediaId));
	invalidate(`show:${source}:${mediaId}`);
	expire('watchlist:');

	return json({ ok: true });
};
