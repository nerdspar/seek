/**
 * Client side of Web Push: turn a browser into a subscribed device, or forget
 * it. All the secrets stay on the server — the only thing that comes down here
 * is the public VAPID key, which is public by design.
 *
 * iOS runs this only inside the home-screen PWA on 16.4+, and permission must be
 * asked from a user gesture — both of which the settings toggle honours.
 */

export type PushStatus = {
	/** The browser has the APIs at all (a plain iOS Safari tab does not). */
	supported: boolean;
	/** The server has VAPID keys configured. */
	configured: boolean;
	/** Notification.permission, or 'unsupported'. */
	permission: NotificationPermission | 'unsupported';
	/** This device currently has a live subscription. */
	subscribed: boolean;
};

const supported = () =>
	typeof window !== 'undefined' &&
	'serviceWorker' in navigator &&
	'PushManager' in window &&
	'Notification' in window;

function urlBase64ToUint8Array(base64: string): Uint8Array {
	const padding = '='.repeat((4 - (base64.length % 4)) % 4);
	const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(b64);
	return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function serverConfig(): Promise<{ configured: boolean; publicKey: string }> {
	try {
		const r = await fetch('/api/push');
		if (!r.ok) return { configured: false, publicKey: '' };
		return await r.json();
	} catch {
		return { configured: false, publicKey: '' };
	}
}

export async function pushStatus(): Promise<PushStatus> {
	if (!supported()) {
		return { supported: false, configured: false, permission: 'unsupported', subscribed: false };
	}
	const { configured } = await serverConfig();
	const reg = await navigator.serviceWorker.ready.catch(() => null);
	const sub = reg ? await reg.pushManager.getSubscription() : null;
	return {
		supported: true,
		configured,
		permission: Notification.permission,
		subscribed: Boolean(sub)
	};
}

/** Ask permission, subscribe, and register with the server. Throws with a
 *  human-readable message the toggle can surface. */
export async function subscribe(): Promise<void> {
	if (!supported()) throw new Error('This device cannot receive notifications.');
	const { configured, publicKey } = await serverConfig();
	if (!configured || !publicKey) throw new Error('Notifications are not set up on the server.');

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') throw new Error('Notification permission was not granted.');

	const reg = await navigator.serviceWorker.ready;
	const sub =
		(await reg.pushManager.getSubscription()) ??
		(await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource
		}));

	const res = await fetch('/api/push', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(sub.toJSON())
	});
	if (!res.ok) {
		// Surface the server's own reason rather than a blank "it failed" — a 500
		// here is usually the /data volume not being writable by the container.
		const detail = await res.json().catch(() => null);
		const reason =
			detail?.message && detail.message !== 'Internal Error' ? detail.message : `HTTP ${res.status}`;
		throw new Error(`Couldn't register this device — ${reason}.`);
	}
}

/** Unsubscribe locally and tell the server to forget the endpoint. */
export async function unsubscribe(): Promise<void> {
	if (!supported()) return;
	const reg = await navigator.serviceWorker.ready.catch(() => null);
	const sub = reg ? await reg.pushManager.getSubscription() : null;
	if (!sub) return;
	const { endpoint } = sub.toJSON();
	await sub.unsubscribe().catch(() => {});
	await fetch('/api/push', {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpoint })
	}).catch(() => {});
}

/** Fire a test notification to every subscribed device. */
export async function sendTest(): Promise<void> {
	const res = await fetch('/api/push/test', { method: 'POST' });
	if (!res.ok) throw new Error('Test failed — the server could not send.');
}
