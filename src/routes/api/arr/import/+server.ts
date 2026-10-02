import { json, error } from '@sveltejs/kit';
import { getManualImport, runManualImport } from '$lib/server/arr';
import { serviceFor, requireConfigured, requireManage, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

/** Candidate files for an import-blocked download, with the suggested mapping. */
export const GET: RequestHandler = async ({ url }) => {
	await requireManage();
	const downloadId = url.searchParams.get('downloadId');
	if (!downloadId) error(400, 'downloadId is required');
	const service = serviceFor(url.searchParams.get('mediaType') ?? 'tv');
	requireConfigured(service);
	try {
		return json({ candidates: await getManualImport(service, downloadId) });
	} catch (err) {
		arrFail(err, service);
	}
};

type Body = { mediaType?: string; downloadId?: string; fileIds?: number[]; importMode?: string };

/** Import the chosen candidate files, resolving a stuck download. */
export const POST: RequestHandler = async ({ request }) => {
	await requireManage();
	const body = (await request.json().catch(() => ({}))) as Body;
	if (!body.downloadId || !Array.isArray(body.fileIds) || !body.fileIds.length) {
		error(400, 'downloadId and fileIds are required');
	}
	const service = serviceFor(body.mediaType);
	requireConfigured(service);
	try {
		await runManualImport(service, body.downloadId, body.fileIds, body.importMode ?? 'move');
		return json({ ok: true });
	} catch (err) {
		arrFail(err, service);
	}
};
