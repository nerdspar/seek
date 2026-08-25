/** Single-household session (§2): one shared passphrase, one signed cookie.
 *
 *  §2 assumed LAN-only. Exposing Seek through a tunnel changes the threat model
 *  — the login endpoint becomes reachable by anyone who resolves the hostname,
 *  and scanners find new hostnames within hours of a certificate being issued.
 *  What that costs is handled here: tokens carry an age the server enforces, and
 *  failed attempts are throttled hard enough that guessing is not a strategy.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export const COOKIE = 'seek_session';

/** Matches the cookie's Max-Age. The cookie alone is only a client-side promise:
 *  a browser honours it, but a copied token would otherwise stay valid forever,
 *  so the same limit is enforced on the token itself. */
export const SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function secret(): string {
	const s = env.SEEK_SESSION_SECRET;
	if (!s) throw new Error('SEEK_SESSION_SECRET is required when SEEK_PASSPHRASE is set.');
	return s;
}

/** Empty passphrase disables the gate — the default for LAN-only use. */
export const gateEnabled = () => Boolean(env.SEEK_PASSPHRASE);

export function issue(): string {
	const issued = String(Date.now());
	const mac = createHmac('sha256', secret()).update(issued).digest('hex');
	return `${issued}.${mac}`;
}

export function verify(token: string | undefined): boolean {
	if (!token) return false;
	const [issued, mac] = token.split('.');
	if (!issued || !mac) return false;

	const expected = createHmac('sha256', secret()).update(issued).digest('hex');
	const a = Buffer.from(mac, 'hex');
	const b = Buffer.from(expected, 'hex');
	if (a.length !== b.length) return false;
	if (!timingSafeEqual(a, b)) return false;

	/* Only after the MAC proves the timestamp is ours is it worth reading — an
	   attacker could otherwise pick any issue date they liked. */
	const at = Number(issued);
	if (!Number.isFinite(at)) return false;
	const age = Date.now() - at;
	// A token stamped in the future is a clock change or a forgery attempt.
	return age >= 0 && age < SESSION_MAX_AGE_MS;
}

export function passphraseMatches(input: string): boolean {
	const expected = env.SEEK_PASSPHRASE ?? '';
	const a = Buffer.from(input);
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
