import { json, error } from '@sveltejs/kit';
import { addMedia, removeMedia } from '$lib/server/search';
import { FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import { expire, invalidate } from '$lib/server/memo';
import type { MediaType } from '$lib/types';
import { settleAdded } from '$lib/server/household/run';
import { classifyShow } from '$lib/server/anime-sync';
import type { RequestHandler } from './$types';

type Body = { mediaType?: MediaType; source?: string; mediaId?: string; title?: string };

/**
 * Every cache that embeds whether something is tracked.
 *
 * The show detail row caches `tracked`, and the `tracked:` search set is the
 * membership list — both are hard-invalidated so a plus on something you just
 * added is never served stale.
 *
 * `discover:` is only *expired*, not invalidated. Rebuilding the Discover feed
 * is one of the slowest cold paths, and hard-dropping it on every add/remove
 * meant the next visit to Discover paid a full rebuild — the "flashing empty
 * squares". The shared membership overlay (status.svelte.ts) already flips the
 * plus on each tile the instant you act, so the feed itself can serve stale and
 * refresh behind: a title you just added lingers one refresh with its check
 * showing, which is fine, and Discover stays instant.
 *
 * The watchlist stays on `expire` too: adding files a show under Planning and the
 * default view is the in-progress backlog, so a stale read is not visibly wrong.
 */
function invalidateTracked(source: string, mediaId: string) {
	expire('watchlist:');
	invalidate('tracked:');
	expire('discover:');
	// The Profile's "Recently added" — the whole point is that a just-added title
	// shows up, so this is actively wrong if served stale.
	invalidate('recent:');
	invalidate(`show:${source}:${mediaId}`);
}


function parse(body: Body) {
	const { mediaType = 'tv', source = 'tmdb', mediaId } = body;
	if (!mediaId) error(400, 'mediaId is required');
	return { mediaType, source, mediaId };
}

/** Start tracking (§6.4). */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Body;
	const { mediaType, source, mediaId } = parse(body);
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
	/* A new show: together or solo? Settled per the household setting; 'pending'
	   tells the button to offer "Watching together" right there. */
	const household = mediaType === 'tv' ? settleAdded({ source, mediaId, title: body.title ?? null }) : null;
	// Shows or Anime: tagged now rather than at the next six-hourly pass.
	if (mediaType === 'tv' && source === 'tmdb') void classifyShow(mediaId);
	return json({ ok: true, household });
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
