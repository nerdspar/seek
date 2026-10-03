/**
 * The server's own secrets — nothing anyone should have to invent and paste into
 * a compose file. Generated on first boot and kept in `/data/secrets.json`
 * (mode 600), next to the database:
 *
 * - `sessionSecret` signs session cookies;
 * - `tokenKey` encrypts stored account links and service keys;
 * - `vapidPublicKey` / `vapidPrivateKey` identify Seek to push services.
 *
 * An env var of the same name still wins (SEEK_SESSION_SECRET, SEEK_TOKEN_KEY,
 * VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY). Older deployments set some of these:
 * the session secret and VAPID keys are copied into the file on first sight, so
 * the env lines can be deleted later without signing anyone out or breaking
 * notifications. SEEK_TOKEN_KEY is deliberately *not* copied — setting it in
 * env is how you keep the key apart from the data it protects (a backup of
 * /data alone then can't decrypt anything); if you set it, keep it set.
 */
import { env } from '$env/dynamic/private';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
import { dataDir } from './db';

type Stored = {
	sessionSecret?: string;
	tokenKey?: string;
	vapidPublicKey?: string;
	vapidPrivateKey?: string;
};

const file = () => join(dataDir(), 'secrets.json');

let cache: Stored | null = null;

function read(): Stored {
	if (cache) return cache;
	const path = file();
	cache = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Stored) : {};
	return cache;
}

/** Write atomically (a crash mid-write must never leave a half file: losing the
 *  token key would orphan every stored link) and owner-only. */
function write(next: Stored): void {
	const path = file();
	mkdirSync(dataDir(), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
	renameSync(tmp, path);
	chmodSync(path, 0o600);
	cache = next;
}

function update(patch: Stored): Stored {
	const next = { ...read(), ...patch };
	write(next);
	return next;
}

const random = () => randomBytes(32).toString('base64url');

export function sessionSecret(): string {
	const stored = read().sessionSecret;
	if (env.SEEK_SESSION_SECRET) {
		if (stored !== env.SEEK_SESSION_SECRET) update({ sessionSecret: env.SEEK_SESSION_SECRET });
		return env.SEEK_SESSION_SECRET;
	}
	return stored ?? update({ sessionSecret: random() }).sessionSecret!;
}

export function tokenKey(): string {
	if (env.SEEK_TOKEN_KEY) return env.SEEK_TOKEN_KEY;
	return read().tokenKey ?? update({ tokenKey: random() }).tokenKey!;
}

/** Whether the token key came from env (kept apart from /data) or the file. */
export const tokenKeyFromEnv = () => Boolean(env.SEEK_TOKEN_KEY);

export function vapidKeys(): { publicKey: string; privateKey: string } {
	if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
		const s = read();
		if (s.vapidPublicKey !== env.VAPID_PUBLIC_KEY || s.vapidPrivateKey !== env.VAPID_PRIVATE_KEY) {
			update({ vapidPublicKey: env.VAPID_PUBLIC_KEY, vapidPrivateKey: env.VAPID_PRIVATE_KEY });
		}
		return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
	}
	const s = read();
	if (s.vapidPublicKey && s.vapidPrivateKey) return { publicKey: s.vapidPublicKey, privateKey: s.vapidPrivateKey };
	const fresh = webpush.generateVAPIDKeys();
	update({ vapidPublicKey: fresh.publicKey, vapidPrivateKey: fresh.privateKey });
	return fresh;
}

/** Tests: forget the cached file contents. */
export function resetSecretsCache(): void {
	cache = null;
}
