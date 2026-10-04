import { json, error } from '@sveltejs/kit';
import { setJoint } from '$lib/server/tags';
import { FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import { currentUser } from '$lib/server/userctx';
import { mirroringAvailable, setShared, syncJointTags } from '$lib/server/household/run';
import type { RequestHandler } from './$types';

type Body = { mediaType?: string; source?: string; mediaId?: string; joint?: boolean; title?: string };

/**
 * Toggle the joint tag on one title (§11). For a show, once two people in the
 * household have Floppy linked, "together" also means *shared*: plays of it are
 * mirrored between you (household/mirror.ts), starting with a one-time backfill.
 */
export const PUT: RequestHandler = async ({ request }) => {
	const { mediaType = 'tv', source = 'tmdb', mediaId, joint, title } = (await request.json()) as Body;
	if (!mediaId || typeof joint !== 'boolean') error(400, 'mediaId and joint are required');

	try {
		const tags = await setJoint(mediaType, source, mediaId, joint);
		const me = currentUser();
		let shared: boolean | undefined;
		if ((mediaType === 'tv' || mediaType === 'movie') && me && mirroringAvailable(me.householdId)) {
			shared = setShared(me.householdId, me.id, { source, mediaId, mediaType, title: title ?? null }, joint);
			await syncJointTags(me.householdId, { source, mediaId, mediaType }, joint, me.id);
		}
		return json({ ok: true, tags, shared });
	} catch (err) {
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable; nothing changed.');
		if (err instanceof FloppyError) error(502, err.message);
		throw err;
	}
};
