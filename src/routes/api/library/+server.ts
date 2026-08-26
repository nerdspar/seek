import { json, error } from '@sveltejs/kit';
import { addMedia, removeMedia } from '$lib/server/search';
import { FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import { expire } from '$lib/server/memo';
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
	} catch (err) {
		/* 409 "Media is already tracked" is the end state the caller asked for, so
		   it is a success. It should be unreachable — every surface that offers an
		   add now knows what is tracked — but a stale page in a backgrounded PWA
		   can still send one, and that must not read as a failure. */
		if (err instanceof FloppyError && err.status === 409) {
			expire('tracked:');
			return json({ ok: true, alreadyTracked: true });
		}
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable; nothing was added.');
		if (err instanceof FloppyError) error(502, err.message);
		throw err;
	}
	expire('watchlist:');
	// Suggestions are filtered against this, so it has to move with the library.
	expire('tracked:');
	return json({ ok: true });
};

/** Undo an add. */
export const DELETE: RequestHandler = async ({ request }) => {
	const { mediaType, source, mediaId } = parse(await request.json());
	try {
		await removeMedia(mediaType, source, mediaId);
		expire('watchlist:');
		expire('tracked:');
		return json({ ok: true });
	} catch (err) {
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable; nothing was removed.');
		if (err instanceof FloppyError) error(502, err.message);
		throw err;
	}
};
