/**
 * Password hashing and secret-at-rest encryption for the household user store.
 *
 * - Passwords: scrypt (Node built-in, no dependency), stored self-describing as
 *   `scrypt$N$r$p$salt$hash` so the cost can be raised later without breaking
 *   existing hashes.
 * - Secrets Seek holds on a user's behalf (BookOrbit password, Hardcover
 *   token): AES-256-GCM under the token key (secrets.ts), stored as
 *   `v1:iv:tag:ciphertext` (base64url). GCM authenticates, so a tampered or
 *   wrong-key value fails loudly instead of decrypting to garbage.
 */
import { generatedTokenKey, tokenKey } from './secrets';
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	scrypt as scryptCb,
	timingSafeEqual,
	type ScryptOptions
} from 'node:crypto';

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
	return new Promise((resolve, reject) =>
		scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)))
	);
}

/* 2^15 keeps a hash around ~50–100ms on modest hardware — slow enough to make
   offline guessing expensive, fast enough that a login is not noticeably slow.
   maxmem is raised because N=2^15, r=8 needs 32 MiB, Node's default ceiling. */
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
	return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/** Constant-time check. A malformed stored hash verifies as false, never throws. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split('$');
	if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
	const [n, r, p] = parts.slice(1, 4).map(Number);
	if (![n, r, p].every((x) => Number.isInteger(x) && x > 0)) return false;
	const salt = Buffer.from(parts[4], 'base64url');
	const expected = Buffer.from(parts[5], 'base64url');
	if (!expected.length) return false;
	const actual = await scrypt(password, salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
	return timingSafeEqual(actual, expected);
}

// Any high-entropy string works; hashing normalises it to the 32 bytes AES-256 needs.
const derive = (raw: string) => createHash('sha256').update(raw).digest();
const key = () => derive(tokenKey());

export function encryptSecret(plain: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key(), iv);
	const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return ['v1', iv, tag, ct].map((x) => (typeof x === 'string' ? x : x.toString('base64url'))).join(':');
}

function decryptWith(k: Buffer, iv: string, tag: string, ct: string): string {
	const decipher = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
	decipher.setAuthTag(Buffer.from(tag, 'base64url'));
	return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export function decryptSecret(stored: string): string {
	const [version, iv, tag, ct] = stored.split(':');
	if (version !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Unrecognised secret format');
	try {
		return decryptWith(key(), iv, tag, ct);
	} catch (err) {
		/* SEEK_TOKEN_KEY added after Seek had already generated its own key:
		   anything saved before then was encrypted with the generated one. GCM's
		   tag check means a wrong key fails loudly, never decrypts to garbage. */
		const earlier = generatedTokenKey();
		if (earlier && earlier !== tokenKey()) return decryptWith(derive(earlier), iv, tag, ct);
		throw err;
	}
}

/** A random, URL-safe token (invites, password resets) and the hash we store
 *  for it — the raw token only ever lives in the link we hand out. */
export function newOpaqueToken(): { token: string; hash: string } {
	const token = randomBytes(32).toString('base64url');
	return { token, hash: hashToken(token) };
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');
