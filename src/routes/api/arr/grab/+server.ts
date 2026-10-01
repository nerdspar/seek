import { json, error } from '@sveltejs/kit';
import { grabRelease } from '$lib/server/arr';
import { serviceFor, requireConfigured, requireManage, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

type Body = { mediaType?: string; guid?: string; indexerId?: number };

/** Grab a chosen release from the interactive sheet. The real side-effect of the
 *  whole feature, so it's its own small endpoint and always user-initiated. */
export const POST: RequestHandler = async ({ request }) => {
	await requireManage();
	const body = (await request.json().catch(() => ({}))) as Body;
	if (!body.guid || typeof body.indexerId !== 'number') error(400, 'guid and indexerId are required');

	const service = serviceFor(body.mediaType);
	requireConfigured(service);
	try {
		await grabRelease(service, body.guid, body.indexerId);
		return json({ ok: true });
	} catch (err) {
		arrFail(err, service);
	}
};
