import { json, error } from '@sveltejs/kit';
import { expire, invalidate } from '$lib/server/memo';
import type { MediaType } from '$lib/types';
import { settleAdded } from '$lib/server/household/run';
import { currentUser } from '$lib/server/userctx';
import { tmdbIdOf, untrack } from '$lib/server/tracking/write';
import { addTitle } from '$lib/server/tracking/add';
import type { RequestHandler } from './$types';

type Body = { mediaType?: MediaType; source?: string; mediaId?: string; title?: string };

/**
 * Every cache that embeds whether something is tracked. `discover:` is only
 * expired: the shared membership overlay (status.svelte.ts) already flips the
 * plus on each tile, so the feed can refresh behind.
 */
function invalidateTracked(source: string, mediaId: string) {
	expire('watchlist:');
	invalidate('tracked:');
	invalidate('onserver:');
	expire('discover:');
	invalidate('recent:');
	expire('library:');
	expire('collection:');
	expire('upcoming');
	invalidate(`show:${source}:${mediaId}`);
}

function parse(body: Body) {
	const { mediaType = 'tv', source = 'tmdb', mediaId } = body;
	if (!mediaId) error(400, 'mediaId is required');
	const tmdbId = tmdbIdOf(source, mediaId);
	if (tmdbId === null) error(400, 'Only TMDB titles can be tracked');
	const me = currentUser();
	if (!me) error(401);
	return { mediaType, source, mediaId, tmdbId, kind: mediaType === 'movie' ? ('movie' as const) : ('tv' as const), me };
}

/** Start tracking (§6.4). */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Body;
	const { mediaType, source, mediaId, tmdbId, kind, me } = parse(body);
	const { already } = await addTitle(me.id, kind, tmdbId);
	invalidateTracked(source, mediaId);
	if (already) return json({ ok: true, alreadyTracked: true });
	/* A new show: together or solo? Settled per the household setting; 'pending'
	   tells the button to offer "Watching together" right there. */
	const household = mediaType === 'tv' ? settleAdded({ source, mediaId, title: body.title ?? null }) : null;
	return json({ ok: true, household });
};

/** Stop tracking: the title and your plays of it. */
export const DELETE: RequestHandler = async ({ request }) => {
	const { source, mediaId, tmdbId, kind, me } = parse(await request.json());
	untrack(me.id, kind, tmdbId);
	invalidateTracked(source, mediaId);
	return json({ ok: true });
};
