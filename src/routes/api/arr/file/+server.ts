import { json, error } from '@sveltejs/kit';
import { deleteFile, dropDetailCache } from '$lib/server/arr';
import { serviceFor, requireConfigured, requireManage, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

type Body = { mediaType?: string; fileId?: number; tmdbId?: string | number };

/** Delete a downloaded file (episode or movie). The caller confirms first; a
 *  "replace" is this followed by an interactive search, done client-side. */
export const DELETE: RequestHandler = async ({ request }) => {
	await requireManage();
	const body = (await request.json().catch(() => ({}))) as Body;
	if (typeof body.fileId !== 'number') error(400, 'fileId is required');

	const service = serviceFor(body.mediaType);
	requireConfigured(service);
	try {
		await deleteFile(service, body.fileId);
		if (body.tmdbId != null) dropDetailCache(service, String(body.tmdbId));
		return json({ ok: true });
	} catch (err) {
		arrFail(err, service);
	}
};
