import { json, error } from '@sveltejs/kit';
import { pushConfigured, sendToAll } from '$lib/server/push';
import { buildTodayDigest } from '$lib/server/digest';
import type { RequestHandler } from './$types';

/**
 * Send a notification right now so the toggle can prove the whole chain works on
 * the device. Uses today's real digest if something airs, otherwise a fixed
 * "notifications are working" payload — either way the phone gets something.
 */
export const POST: RequestHandler = async () => {
	if (!pushConfigured()) error(503, 'Push is not configured on the server.');
	const digest = await buildTodayDigest();
	const payload = digest ?? {
		title: 'Seek notifications are on',
		body: "You'll get a morning list when your shows air.",
		url: '/upcoming'
	};
	const { sent, pruned } = await sendToAll({ ...payload, tag: 'seek-test' });
	return json({ ok: true, sent, pruned });
};
