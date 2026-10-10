import { json, error } from '@sveltejs/kit';
import { setJoint } from '$lib/server/tags';
import { currentUser } from '$lib/server/userctx';
import { mirroringAvailable } from '$lib/server/household/run';
import type { RequestHandler } from './$types';

type Body = { mediaType?: string; source?: string; mediaId?: string; joint?: boolean; title?: string };

/**
 * Watched together or not (§11): shares or unshares the title for the household.
 * Newly shared, each of you is caught up with the other's plays.
 */
export const PUT: RequestHandler = async ({ request }) => {
	const { mediaType = 'tv', source = 'tmdb', mediaId, joint, title } = (await request.json()) as Body;
	if (!mediaId || typeof joint !== 'boolean') error(400, 'mediaId and joint are required');
	const me = currentUser();
	if (!me) error(401);
	const tags = await setJoint(mediaType, source, mediaId, joint, title ?? null);
	return json({ ok: true, tags, shared: mirroringAvailable(me.householdId) ? joint : undefined });
};
