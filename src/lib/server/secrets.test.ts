import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resetSecretsCache, sessionSecret, tokenKey, tokenKeyFromEnv, vapidKeys } from './secrets';
import { decryptSecret, encryptSecret } from './crypto';

const saved = { ...process.env };
function restoreEnv(saved: NodeJS.ProcessEnv) {
	// Mutate in place: the $env stub holds this very object.
	for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
	Object.assign(process.env, saved);
}

let dir: string;
const file = () => join(dir, 'secrets.json');
const stored = () => JSON.parse(readFileSync(file(), 'utf8'));

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'seek-secrets-'));
	process.env.SEEK_DATA_DIR = dir;
	for (const k of ['SEEK_SESSION_SECRET', 'SEEK_TOKEN_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) delete process.env[k];
	resetSecretsCache();
});
afterEach(() => {
	restoreEnv(saved);
	resetSecretsCache();
	rmSync(dir, { recursive: true, force: true });
});

describe('generated secrets', () => {
	it('are made on first use, saved owner-only, and stable after a restart', () => {
		const s = sessionSecret();
		const k = tokenKey();
		const v = vapidKeys();
		expect(s).toHaveLength(43);
		expect(k).not.toBe(s);
		expect(v.publicKey).toBeTruthy();
		expect(statSync(file()).mode & 0o777).toBe(0o600);

		resetSecretsCache(); // as if the container restarted
		expect(sessionSecret()).toBe(s);
		expect(tokenKey()).toBe(k);
		expect(vapidKeys()).toEqual(v);
	});
});

describe('env from an older deployment', () => {
	it('copies the session secret and VAPID keys so the env lines can go', () => {
		process.env.SEEK_SESSION_SECRET = 'old-session';
		process.env.VAPID_PUBLIC_KEY = 'pub';
		process.env.VAPID_PRIVATE_KEY = 'priv';
		expect(sessionSecret()).toBe('old-session');
		expect(vapidKeys()).toEqual({ publicKey: 'pub', privateKey: 'priv' });

		delete process.env.SEEK_SESSION_SECRET;
		delete process.env.VAPID_PUBLIC_KEY;
		delete process.env.VAPID_PRIVATE_KEY;
		resetSecretsCache();
		// Nobody signed out, existing push subscriptions still valid.
		expect(sessionSecret()).toBe('old-session');
		expect(vapidKeys()).toEqual({ publicKey: 'pub', privateKey: 'priv' });
	});

	it('keeps an env token key out of the file (that is the point of setting it)', () => {
		process.env.SEEK_TOKEN_KEY = 'kept-apart';
		expect(tokenKey()).toBe('kept-apart');
		expect(tokenKeyFromEnv()).toBe(true);
		expect(existsSync(file()) ? stored().tokenKey : undefined).toBeUndefined();
	});

	it('adding SEEK_TOKEN_KEY after Seek already ran still reads what was stored before', () => {
		const before = encryptSecret('flp_saved_earlier'); // generated key, in the file
		process.env.SEEK_TOKEN_KEY = 'added-later';
		resetSecretsCache();
		expect(decryptSecret(before)).toBe('flp_saved_earlier');
		const after = encryptSecret('flp_saved_now');
		expect(decryptSecret(after)).toBe('flp_saved_now');
		// New writes use the env key: without it they can't be read.
		delete process.env.SEEK_TOKEN_KEY;
		expect(() => decryptSecret(after)).toThrow();
	});
});
