import { json, error } from '@sveltejs/kit';
import { addMedia, removeMedia } from '$lib/server/search';
import { FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import { expire, invalidate } from '$lib/server/memo';
import type { MediaType } from '$lib/types';
import type { RequestHandler } from './$types';

type Body = { mediaType?: MediaType; source?: string; mediaId?: string };

/**
 * Every cache that embeds whether something is tracked.
 *
 * Expiring the tracked set alone is not enough, and was the bug: Discover
 * caches its rows *after* filtering against that set, and the show detail
 * caches `tracked` on the row itself. So adding from Discover left the show
 * page still offering "Add to library", and going back re-rendered the plus
 * from a 30-minute-old row.
 *
 * These are invalidated rather than expired. `expire` only marks an entry
 * stale, and the cache deliberately serves stale while it refreshes — which
 * would hand back the same wrong answer on exactly the load that matters. A
 * plus on something you just added is the "actively wrong if served stale"
 * case invalidate exists for.
 *
 * The watchlist stays on `expire`: adding files a show under Planning, and the
 * default view is the in-progress backlog, so a stale read is not visibly
 * wrong and this keeps marking cheap.
 */
function invalidateTracked(source: string, mediaId: string) {
	expire('watchlist:');
	invalidate('tracked:');
	invalidate('discover:');
	invalidate(`show:${source}:${mediaId}`);
}


function parse(body: Body) {
	const { mediaType = 'tv', source = 'tmdb', mediaId } = body;
	if (!mediaId) error(400, 'mediaId is required');
	return { mediaType, source, mediaId };
}

/** Start tracking (§6.4). */
export const POST: RequestHandler = async ({ request }) => {
	const { mediaType, source, mediaId } = parse(await request.json());
	try {
		await addMedia(mediaType, source, mediaId);
	} catch (err) {
		/* 409 "Media is already tracked" is the end state the caller asked for, so
		   it is a success. It should be unreachable — every surface that offers an
		   add now knows what is tracked — but a stale page in a backgrounded PWA
		   can still send one, and that must not read as a failure. */
		if (err instanceof FloppyError && err.status === 409) {
			invalidateTracked(source, mediaId);
			return json({ ok: true, alreadyTracked: true });
		}
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable; nothing was added.');
		if (err instanceof FloppyError) error(502, err.message);
		throw err;
	}
	invalidateTracked(source, mediaId);
	return json({ ok: true });
};

/** Undo an add. */
export const DELETE: RequestHandler = async ({ request }) => {
	const { mediaType, source, mediaId } = parse(await request.json());
	try {
		await removeMedia(mediaType, source, mediaId);
		invalidateTracked(source, mediaId);
		return json({ ok: true });
	} catch (err) {
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable; nothing was removed.');
		if (err instanceof FloppyError) error(502, err.message);
		throw err;
	}
};
