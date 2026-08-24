import { json, error } from '@sveltejs/kit';
import { addMedia, removeMedia } from '$lib/server/search';
import { FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import type { MediaType } from '$lib/types';
import type { RequestHandler } from './$types';

type Body = { mediaType?: MediaType; source?: string; mediaId?: string };

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
		return json({ ok: true });
	} catch (err) {
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable; nothing was added.');
		if (err instanceof FloppyError) error(502, err.message);
		throw err;
	}
};

/** Undo an add. */
export const DELETE: RequestHandler = async ({ request }) => {
	const { mediaType, source, mediaId } = parse(await request.json());
	try {
		await removeMedia(mediaType, source, mediaId);
		return json({ ok: true });
	} catch (err) {
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable; nothing was removed.');
		if (err instanceof FloppyError) error(502, err.message);
		throw err;
	}
};
