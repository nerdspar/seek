/**
 * Web Push plumbing — VAPID config, the device subscription store, and sending.
 *
 * Only the *public* VAPID key ever reaches the browser (it is meant to); the
 * private key and every subscription stay here. Subscriptions belong to a person
 * (her phone gets her digest, about her shows), so they live in the user store
 * keyed by account, and every read/write here acts for the current user
 * (userctx). The pre-accounts JSON file is imported for the owner at setup.
 */
import { env } from '$env/dynamic/private';
import { readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import webpush from 'web-push';
import { db, nowIso } from './db';
import { currentUser } from './userctx';
import { getNotifyState, setNotifyState } from './users';

export type PushSub = {
	endpoint: string;
	keys: { p256dh: string; auth: string };
};

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

/** Push state is always someone's; acting with no user is a bug, not a no-op. */
function me(): number {
	const u = currentUser();
	if (!u) throw new Error('Push subscriptions need a signed-in user.');
	return u.id;
}

/** Register this device for the current user. The endpoint is the device's
 *  identity: re-subscribing refreshes it, and a device that switched accounts
 *  now belongs to whoever subscribed it last. */
export async function addSubscription(sub: PushSub): Promise<void> {
	db()
		.prepare(
			`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id,
			   p256dh = excluded.p256dh, auth = excluded.auth`
		)
		.run(sub.endpoint, me(), sub.keys.p256dh, sub.keys.auth, nowIso());
}

/** Forget one of the current user's devices. */
export async function removeSubscription(endpoint: string): Promise<void> {
	db().prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, me());
}

/** How many devices the current user has subscribed. */
export async function subscriptionCount(): Promise<number> {
	return (
		db().prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(me()) as { n: number }
	).n;
}

export async function getLastDigest(): Promise<string | null> {
	return getNotifyState(me()).lastDigest;
}
export async function setLastDigest(day: string): Promise<void> {
	setNotifyState(me(), { lastDigest: day });
}

export async function getLastAtTime(): Promise<string | null> {
	return getNotifyState(me()).lastAtTime;
}
export async function setLastAtTime(iso: string): Promise<void> {
	setNotifyState(me(), { lastAtTime: iso });
}

type SubRow = { endpoint: string; p256dh: string; auth: string };

/**
 * Send a payload to every device the current user has subscribed. A 404/410
 * means the browser threw the subscription away, so we drop it too — otherwise
 * dead endpoints pile up.
 */
export async function sendToDevices(payload: {
	title: string;
	body: string;
	url?: string;
	tag?: string;
}): Promise<{ sent: number; pruned: number }> {
	ensureVapid();
	if (!configured) return { sent: 0, pruned: 0 };

	const subs = db()
		.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
		.all(me()) as SubRow[];
	const data = JSON.stringify(payload);
	let sent = 0;
	const dead: string[] = [];

	await Promise.all(
		subs.map(async (s) => {
			try {
				await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data);
				sent++;
			} catch (err) {
				const status = (err as { statusCode?: number })?.statusCode;
				if (status === 404 || status === 410) dead.push(s.endpoint);
			}
		})
	);

	for (const endpoint of dead) db().prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
	return { sent, pruned: dead.length };
}

/**
 * One-time import of the pre-accounts subscription file for the owner, so the
 * devices that already had notifications keep getting them. The file is renamed
 * afterwards so the import can't run twice.
 */
export async function importLegacyPush(ownerId: number): Promise<number> {
	const path = join(env.SEEK_DATA_DIR || '/data', 'push-subscriptions.json');
	let parsed: { subs?: PushSub[]; lastDigest?: string | null; lastAtTime?: string | null };
	try {
		parsed = JSON.parse(await readFile(path, 'utf8'));
	} catch {
		return 0; // No legacy file — nothing to import.
	}
	const subs = (parsed.subs ?? []).filter((s) => s?.endpoint && s.keys?.p256dh && s.keys?.auth);
	const insert = db().prepare(
		`INSERT OR IGNORE INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at)
		 VALUES (?, ?, ?, ?, ?)`
	);
	db().transaction(() => {
		for (const s of subs) insert.run(s.endpoint, ownerId, s.keys.p256dh, s.keys.auth, nowIso());
	})();
	setNotifyState(ownerId, {
		...(parsed.lastDigest ? { lastDigest: parsed.lastDigest } : {}),
		...(parsed.lastAtTime ? { lastAtTime: parsed.lastAtTime } : {})
	});
	await rename(path, `${path}.imported`).catch(() => {});
	return subs.length;
}
