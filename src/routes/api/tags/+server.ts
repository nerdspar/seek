import { json, error } from '@sveltejs/kit';
import { setJoint } from '$lib/server/tags';
import { FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import type { RequestHandler } from './$types';

type Body = { mediaType?: string; source?: string; mediaId?: string; joint?: boolean };

/** Toggle the joint tag on one title (§11). */
export const PUT: RequestHandler = async ({ request }) => {
	const { mediaType = 'tv', source = 'tmdb', mediaId, joint } = (await request.json()) as Body;
	if (!mediaId || typeof joint !== 'boolean') error(400, 'mediaId and joint are required');

	try {
		return json({ ok: true, tags: await setJoint(mediaType, source, mediaId, joint) });
	} catch (err) {
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable; nothing changed.');
		if (err instanceof FloppyError) error(502, err.message);
		throw err;
	}
};
