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

/**
 * A stored endpoint is later POSTed to by the server (webpush.sendNotification),
 * so on a gate-disabled LAN deployment an unchecked endpoint is an SSRF handle.
 * A real push endpoint is always an https URL on a public push-service host —
 * never loopback, an IP literal, or an internal name.
 */
function validPushEndpoint(raw: string): boolean {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return false;
	}
	if (u.protocol !== 'https:') return false;
	const host = u.hostname.toLowerCase();
	if (host === 'localhost' || host.endsWith('.localhost')) return false;
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literal
	if (host.includes(':')) return false; // IPv6 literal
	if (/\.(local|internal|lan|home|corp)$/.test(host)) return false;
	return true;
}

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
	if (!validPushEndpoint(endpoint)) error(400, 'That push endpoint is not allowed.');
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
