/** Single-household session (§2): one shared passphrase, one signed cookie.
 *  LAN-only by design — see the warning in §2 before putting Seek behind a
 *  reverse proxy. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export const COOKIE = 'seek_session';

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
	return timingSafeEqual(a, b);
}

export function passphraseMatches(input: string): boolean {
	const expected = env.SEEK_PASSPHRASE ?? '';
	const a = Buffer.from(input);
	const b = Buffer.from(expected);
	// Length leaks either way; the compare itself stays constant-time.
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}
