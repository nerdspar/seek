import { json } from '@sveltejs/kit';
import { cancelUpload, uploadStatus } from '$lib/server/books/bookorbit';
import { relayRefusal, uploadId } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

/** Where an upload is — importing carries on in BookOrbit after it completes. */
export const GET: RequestHandler = async ({ params }) =>
	json(await uploadStatus(uploadId(params.id)).catch(relayRefusal));

/** Abandon an upload. */
export const DELETE: RequestHandler = async ({ params }) => {
	await cancelUpload(uploadId(params.id)).catch(relayRefusal);
	return json({ ok: true });
};
