import { json, error } from '@sveltejs/kit';
import { listShared } from '$lib/server/household/shared';
import { mirrorMembers } from '$lib/server/household/mirror';
import { setShared } from '$lib/server/household/run';
import { expire } from '$lib/server/memo';
import type { RequestHandler } from './$types';

/** The household's shared shows, and whether sharing is on (two people or more). */
export const GET: RequestHandler = async ({ locals }) => {
	const me = locals.user;
	if (!me) error(401);
	return json({
		waitingOn: [],
		mirroring: mirrorMembers(me.householdId).length >= 2,
		shows: listShared(me.householdId)
	});
};

/** Stop sharing a show (plays already carried over stay). */
export const DELETE: RequestHandler = async ({ locals, request }) => {
	const me = locals.user;
	if (!me) error(401);
	const { source, mediaId, mediaType: kind } = await request.json().catch(() => ({}));
	if (typeof source !== 'string' || typeof mediaId !== 'string') error(400, 'source and mediaId are required');
	const mediaType = kind === 'movie' ? ('movie' as const) : ('tv' as const);
	setShared(me.householdId, me.id, { source, mediaId, mediaType }, false);
	expire('watchlist:');
	return json({ ok: true });
};
