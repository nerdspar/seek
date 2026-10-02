import { json, error } from '@sveltejs/kit';
import { getQueue, removeQueueItem, sonarrConfigured, radarrConfigured, type Service } from '$lib/server/arr';
import { requireManage, requireConfigured, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

/** What's downloading now, across both services. Each configured service is
 *  queried independently; one being down just yields an empty list for it rather
 *  than failing the whole call, so a partial stack still shows progress. */
export const GET: RequestHandler = async () => {
	await requireManage();
	const [sonarr, radarr] = await Promise.all([
		sonarrConfigured() ? getQueue('sonarr').catch(() => []) : Promise.resolve([]),
		radarrConfigured() ? getQueue('radarr').catch(() => []) : Promise.resolve([])
	]);
	return json({ sonarr, radarr });
};

type DelBody = { service?: Service; id?: number; removeFromClient?: boolean; blocklist?: boolean };

/** Remove a queue item — optionally deleting it from the download client and/or
 *  blocklisting the release so a re-search skips it. */
export const DELETE: RequestHandler = async ({ request }) => {
	await requireManage();
	const body = (await request.json().catch(() => ({}))) as DelBody;
	const service: Service = body.service === 'radarr' ? 'radarr' : 'sonarr';
	if (typeof body.id !== 'number') error(400, 'id is required');
	requireConfigured(service);
	try {
		await removeQueueItem(service, body.id, {
			removeFromClient: body.removeFromClient,
			blocklist: body.blocklist
		});
		return json({ ok: true });
	} catch (err) {
		arrFail(err, service);
	}
};
