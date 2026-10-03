import { json } from '@sveltejs/kit';
import { finishUpload } from '$lib/server/books/bookorbit';
import { relayRefusal, uploadId } from '$lib/server/books/http';
import type { RequestHandler } from './$types';

/** Every byte is in: BookOrbit validates the file and files it. */
export const POST: RequestHandler = async ({ params }) =>
	json(await finishUpload(uploadId(params.id)).catch(relayRefusal));
