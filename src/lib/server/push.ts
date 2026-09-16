/**
 * Web Push plumbing — VAPID config, the device subscription store, and sending.
 *
 * Only the *public* VAPID key ever reaches the browser (it is meant to); the
 * private key and every subscription stay here. Subscriptions live in one small
 * JSON file next to preferences.json — Seek's only durable state — because a
 * push subscription must outlive a server restart to be worth anything.
 */
import { env } from '$env/dynamic/private';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import webpush from 'web-push';

export type PushSub = {
	endpoint: string;
	keys: { p256dh: string; auth: string };
};

/** Server-only state kept alongside the subscriptions. */
type Store = {
	subs: PushSub[];
	/** yyyy-mm-dd of the last digest sent, so a restart can't double-send. */
	lastDigest: string | null;
};

const file = () => join(env.SEEK_DATA_DIR || '/data', 'push-subscriptions.json');

export const vapidPublicKey = () => env.VAPID_PUBLIC_KEY || '';
export const pushConfigured = () =>
	Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

let configured = false;
function ensureVapid() {
	if (configured || !pushConfigured()) return;
	webpush.setVapidDetails(
		env.VAPID_SUBJECT || 'mailto:seek@localhost',
		env.VAPID_PUBLIC_KEY!,
		env.VAPID_PRIVATE_KEY!
	);
	configured = true;
}

let cache: Store | null = null;

async function read(): Promise<Store> {
	if (cache) return cache;
	try {
		const parsed = JSON.parse(await readFile(file(), 'utf8')) as Partial<Store>;
		cache = { subs: parsed.subs ?? [], lastDigest: parsed.lastDigest ?? null };
	} catch {
		cache = { subs: [], lastDigest: null };
	}
	return cache;
}

/* Serialised read-modify-write, same shape as prefs — two subscribes at once
   must not clobber each other. */
let writes: Promise<unknown> = Promise.resolve();
function commit(mutate: (s: Store) => void): Promise<Store> {
	const run = writes.then(
		() => write(mutate),
		() => write(mutate)
	);
	writes = run.catch(() => {});
	return run;
}

async function write(mutate: (s: Store) => void): Promise<Store> {
	const next = await read();
	mutate(next);
	const path = file();
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
	await rename(tmp, path);
	cache = next;
	return next;
}

export async function addSubscription(sub: PushSub): Promise<void> {
	await commit((s) => {
		// Endpoint is the identity; re-subscribing the same device just refreshes.
		s.subs = [...s.subs.filter((x) => x.endpoint !== sub.endpoint), sub];
	});
}

export async function removeSubscription(endpoint: string): Promise<void> {
	await commit((s) => {
		s.subs = s.subs.filter((x) => x.endpoint !== endpoint);
	});
}

export async function subscriptionCount(): Promise<number> {
	return (await read()).subs.length;
}

export async function getLastDigest(): Promise<string | null> {
	return (await read()).lastDigest;
}
export async function setLastDigest(day: string): Promise<void> {
	await commit((s) => {
		s.lastDigest = day;
	});
}

/**
 * Send a payload to every subscribed device. A 404/410 means the browser threw
 * the subscription away, so we drop it too — otherwise dead endpoints pile up.
 */
export async function sendToAll(payload: {
	title: string;
	body: string;
	url?: string;
	tag?: string;
}): Promise<{ sent: number; pruned: number }> {
	ensureVapid();
	if (!configured) return { sent: 0, pruned: 0 };

	const { subs } = await read();
	const data = JSON.stringify(payload);
	let sent = 0;
	const dead: string[] = [];

	await Promise.all(
		subs.map(async (sub) => {
			try {
				await webpush.sendNotification(sub, data);
				sent++;
			} catch (err) {
				const status = (err as { statusCode?: number })?.statusCode;
				if (status === 404 || status === 410) dead.push(sub.endpoint);
			}
		})
	);

	for (const endpoint of dead) await removeSubscription(endpoint);
	return { sent, pruned: dead.length };
}
