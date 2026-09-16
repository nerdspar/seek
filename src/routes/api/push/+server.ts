import { json, error } from '@sveltejs/kit';
import {
	addSubscription,
	removeSubscription,
	vapidPublicKey,
	pushConfigured
} from '$lib/server/push';
import type { RequestHandler } from './$types';

/** The public VAPID key the browser needs to subscribe, and whether push is set up. */
export const GET: RequestHandler = async () => {
	return json({ configured: pushConfigured(), publicKey: vapidPublicKey() });
};

/** Register this device's push subscription. */
export const POST: RequestHandler = async ({ request }) => {
	if (!pushConfigured()) error(503, 'Push is not configured on the server.');
	const sub = await request.json().catch(() => null);
	const endpoint = sub?.endpoint;
	const p256dh = sub?.keys?.p256dh;
	const auth = sub?.keys?.auth;
	if (typeof endpoint !== 'string' || !p256dh || !auth) {
		error(400, 'A valid PushSubscription is required.');
	}
	await addSubscription({ endpoint, keys: { p256dh, auth } });
	return json({ ok: true });
};

/** Forget this device (body carries the endpoint that identifies it). */
export const DELETE: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.endpoint !== 'string') error(400, 'endpoint is required.');
	await removeSubscription(body.endpoint);
	return json({ ok: true });
};
