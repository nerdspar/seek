import { json, error } from '@sveltejs/kit';
import { sendChunk } from '$lib/server/books/bookorbit';
import { relayRefusal, uploadId, SEEK_CHUNK_BYTES } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

/** One chunk of an upload, as raw bytes at the `upload-offset` it starts at.
 *  Relayed to BookOrbit with a checksum so it can refuse a damaged chunk. */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = uploadId(params.id);
	const raw = request.headers.get('upload-offset') ?? '';
	if (!/^\d+$/.test(raw)) error(400, 'Upload-Offset must be a non-negative integer.');
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (!bytes.length) error(400, 'Empty chunk.');
	if (bytes.length > SEEK_CHUNK_BYTES) error(413, 'Chunk too large.');
	let name = 'chunk';
	try {
		name = decodeURIComponent(request.headers.get('x-filename') ?? '') || name;
	} catch {
		/* a mangled header just means a generic part name */
	}
	return json(await sendChunk(id, Number(raw), bytes, name).catch(relayRefusal));
};
