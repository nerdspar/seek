/** Account sessions: a signed cookie naming the signed-in user (accounts live in
 *  users.ts). The old shared passphrase now only unlocks first-run setup.
 *
 *  §2 assumed LAN-only. Exposing Seek through a tunnel changes the threat model
 *  — the login endpoint becomes reachable by anyone who resolves the hostname,
 *  and scanners find new hostnames within hours of a certificate being issued.
 *  What that costs is handled here: tokens carry an age the server enforces, and
 *  failed attempts are throttled hard enough that guessing is not a strategy.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { sessionSecret } from './secrets';

export const COOKIE = 'seek_session';

/** Matches the cookie's Max-Age. The cookie alone is only a client-side promise:
 *  a browser honours it, but a copied token would otherwise stay valid forever,
 *  so the same limit is enforced on the token itself. */
export const SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

const secret = () => sessionSecret();

/* ── First-run setup code ─────────────────────────────────────────────────────
   Creating the owner account needs proof that you're whoever deployed Seek —
   otherwise a stranger who finds a fresh instance through the tunnel could
   claim it. That proof is a code only the server's log shows (TrueNAS → Apps →
   Seek → Logs), made fresh each boot. A deployment that still sets
   SEEK_PASSPHRASE (from before accounts) uses that instead. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
let generatedCode: string | null = null;

export function setupCode(): string {
	if (env.SEEK_PASSPHRASE) return env.SEEK_PASSPHRASE;
	generatedCode ??= Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + ALPHABET[randomInt(ALPHABET.length)]).join('');
	return generatedCode;
}

/** True when the setup code is the old SEEK_PASSPHRASE rather than a logged one. */
export const setupCodeIsPassphrase = () => Boolean(env.SEEK_PASSPHRASE);

/** Print the setup code where the person deploying will see it. */
export function announceSetupCode(): void {
	if (setupCodeIsPassphrase()) {
		console.log('[seek] First-run setup: open Seek and enter your SEEK_PASSPHRASE as the setup code.');
	} else {
		console.log(`[seek] First-run setup code: ${setupCode()}  (open Seek in a browser to create your account)`);
	}
}

/* A session names a user and that user's session version. Bumping the version
   in the database (password change, sign out everywhere) kills every cookie
   carrying the old one, without a server-side session table. */
export type SessionClaims = { userId: number; version: number };

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('hex');

export function issue(userId: number, version: number): string {
	const payload = `v2.${userId}.${version}.${Date.now()}`;
	return `${payload}.${sign(payload)}`;
}

export function verify(token: string | undefined): SessionClaims | null {
	if (!token) return null;
	const parts = token.split('.');
	// v2.<user>.<version>.<issued>.<mac> — anything else (including the
	// pre-accounts passphrase cookie) is simply not a session.
	if (parts.length !== 5 || parts[0] !== 'v2') return null;
	const payload = parts.slice(0, 4).join('.');
	const a = Buffer.from(parts[4], 'hex');
	const b = Buffer.from(sign(payload), 'hex');
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

	/* Only after the MAC proves the claims are ours are they worth reading — an
	   attacker could otherwise pick any user or issue date they liked. */
	const [userId, version, issued] = parts.slice(1, 4).map(Number);
	if (![userId, version, issued].every(Number.isFinite)) return null;
	const age = Date.now() - issued;
	// A token stamped in the future is a clock change or a forgery attempt.
	if (age < 0 || age >= SESSION_MAX_AGE_MS) return null;
	return { userId, version };
}

/** Does this match the setup code? Case and spacing forgiven for a typed code. */
export function setupCodeMatches(input: string): boolean {
	const expected = setupCode();
	const typed = setupCodeIsPassphrase() ? input : input.trim().toUpperCase().replace(/\s+/g, '');
	const a = Buffer.from(typed);
	const b = Buffer.from(expected);
	// Length leaks either way; the compare itself stays constant-time.
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/* ---------------------------------------------------------------- throttling */

/** Wrong answers before the lockouts begin. Generous enough to absorb a genuine
 *  typo or a password manager filling the wrong entry. */
const FREE_ATTEMPTS = 5;

/** Lockout lengths, stepping up per failure past the allowance and holding at
 *  the last value. Six wrong answers costs a minute; ten costs two hours. */
const PENALTIES_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 2 * 60 * 60_000];

/** Failures are forgiven after a quiet spell, so one bad day never compounds. */
const DECAY_MS = 6 * 60 * 60 * 1000;

/** Every wrong answer costs this much even before any lockout, which is what
 *  turns a scripted run into an unworkably slow one. */
const FAILURE_DELAY_MS = 750;

type Attempt = { failures: number; lockedUntil: number; last: number };

/* In memory on purpose: a single-container app with one household does not need
   this to survive restarts, and a restart is not something an attacker can
   provoke. Entries are pruned so a flood of source addresses cannot grow it
   without bound. */
const attempts = new Map<string, Attempt>();
const MAX_TRACKED = 5_000;

function prune(now: number): void {
	for (const [key, a] of attempts) {
		if (a.lockedUntil < now && now - a.last > DECAY_MS) attempts.delete(key);
	}
	// Still oversized after pruning: drop the coldest entries.
	if (attempts.size > MAX_TRACKED) {
		const cold = [...attempts.entries()].sort((x, y) => x[1].last - y[1].last);
		for (const [key] of cold.slice(0, attempts.size - MAX_TRACKED)) attempts.delete(key);
	}
}

/** Milliseconds remaining on a lockout, or 0 if the caller may try. */
export function lockedFor(key: string): number {
	const a = attempts.get(key);
	if (!a) return 0;
	const now = Date.now();
	if (a.lockedUntil > now) return a.lockedUntil - now;
	// The lockout has run out; forget the record entirely once it has gone cold.
	if (now - a.last > DECAY_MS) attempts.delete(key);
	return 0;
}

/** Record a wrong passphrase. Returns the lockout it earned, in ms (0 if none). */
export function noteFailure(key: string): number {
	const now = Date.now();
	prune(now);

	const a = attempts.get(key) ?? { failures: 0, lockedUntil: 0, last: now };
	if (now - a.last > DECAY_MS) a.failures = 0;
	a.failures++;
	a.last = now;

	let penalty = 0;
	if (a.failures > FREE_ATTEMPTS) {
		const step = Math.min(a.failures - FREE_ATTEMPTS - 1, PENALTIES_MS.length - 1);
		penalty = PENALTIES_MS[step];
		a.lockedUntil = now + penalty;
	}

	attempts.set(key, a);
	return penalty;
}

export function noteSuccess(key: string): void {
	attempts.delete(key);
}

/** Flat cost on every wrong answer, paid before the response goes back. */
export const failureDelay = () => new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));

/** Human-readable lockout, for telling someone how long they have to wait. */
export function describeWait(ms: number): string {
	const mins = Math.ceil(ms / 60_000);
	if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
	const hours = Math.ceil(mins / 60);
	return `${hours} hour${hours === 1 ? '' : 's'}`;
}
