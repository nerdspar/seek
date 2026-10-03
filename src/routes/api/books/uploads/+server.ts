import { json, error } from '@sveltejs/kit';
import { startUpload, uploadOptions } from '$lib/server/books/bookorbit';
import { relayRefusal, SEEK_CHUNK_BYTES } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

/** What you can upload, where to, and the chunk size to send it in. */
export const GET: RequestHandler = async () =>
	json({ ...(await uploadOptions().catch(relayRefusal)), chunkBytes: SEEK_CHUNK_BYTES });

/** Start uploading one file into BookOrbit (as you). */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}));
	const filename = typeof body.filename === 'string' ? body.filename.trim().slice(0, 500) : '';
	const size = Number(body.size);
	const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
	if (!filename) error(400, 'A file name is required.');
	if (!Number.isSafeInteger(size) || size <= 0) error(400, 'The file is empty.');
	if (!/^[A-Za-z0-9._:-]{8,100}$/.test(key)) error(400, 'Bad upload key.');
	const t = body.target ?? {};
	const libraryId = Number(t.libraryId);
	const target =
		t.kind === 'book_dock'
			? ({ kind: 'book_dock' } as const)
			: t.kind === 'library' && Number.isInteger(libraryId) && libraryId > 0
				? ({ kind: 'library', libraryId } as const)
				: error(400, 'Pick where the book should go.');
	return json(await startUpload({ filename, size, idempotencyKey: key, target }).catch(relayRefusal));
};
