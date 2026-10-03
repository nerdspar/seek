import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getInfo, whoami } from '$lib/server/api';
import { floppyConfigured } from '$lib/server/env';
import { runAs, NotLinkedError } from '$lib/server/userctx';
import type { User } from '$lib/server/users';
import type { RequestHandler } from './$types';

/**
 * Health check: is Floppy up — and, for a signed-in caller, is *their* token
 * accepted? (There's no server-wide token any more; each person links their
 * own.) A Seek that isn't connected to Floppy yet is healthy: it's waiting for
 * setup, not broken.
 *
 * Reachable without a session, because the container's HEALTHCHECK has no way to
 * hold one — see the note in hooks.server.ts. The status code carries the whole
 * signal the healthcheck needs, so an unauthenticated caller gets that and
 * nothing else: the version, timezone and token state are worth keeping to
 * ourselves once this is reachable from outside the LAN.
 */
type Probe = {
	httpStatus: number;
	ok: boolean;
	reachable: boolean;
	version?: string;
	timezone?: string;
	tokenAccepted?: boolean;
	floppyError?: string;
	tokenError?: string;
};

/* Ungated and reachable through the tunnel, so without this every hit is two
   Floppy round trips with no rate limit — an amplification vector. The probe is
   shared for a few seconds; the healthcheck polls every 30s, so it never sees a
   stale answer that matters. */
const PROBE_TTL = 5_000;
const cache = new Map<number, { at: number; probe: Probe }>();

async function runProbe(user: User | null): Promise<Probe> {
	if (!floppyConfigured()) return { httpStatus: 200, ok: true, reachable: false, floppyError: 'Not set up yet' };
	try {
		const info = await getInfo();
		if (!user) return { httpStatus: 200, ok: true, reachable: true, version: info.version, timezone: info.timezone };
		try {
			await runAs(user, () => whoami());
			return {
				httpStatus: 200,
				ok: true,
				reachable: true,
				version: info.version,
				timezone: info.timezone,
				tokenAccepted: true
			};
		} catch (err) {
			// Not having linked Floppy yet is a normal state, not an outage.
			if (err instanceof NotLinkedError) {
				return { httpStatus: 200, ok: true, reachable: true, version: info.version, timezone: info.timezone };
			}
			return {
				httpStatus: 503,
				ok: false,
				reachable: true,
				version: info.version,
				timezone: info.timezone,
				tokenAccepted: false,
				tokenError: String(err)
			};
		}
	} catch (err) {
		return { httpStatus: 503, ok: false, reachable: false, floppyError: String(err) };
	}
}

async function probe(user: User | null): Promise<Probe> {
	const key = user?.id ?? 0;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < PROBE_TTL) return hit.probe;
	const p = await runProbe(user);
	cache.set(key, { at: Date.now(), probe: p });
	return p;
}

export const GET: RequestHandler = async ({ locals }) => {
	const detail = locals.authed;
	const p = await probe(locals.user ?? null);

	const out: Record<string, unknown> = { ok: p.ok };
	// The commit this build came from — reported even if Floppy is down, since
	// "which version am I running?" is exactly what you ask when things look off.
	if (detail) {
		out.build = env.SEEK_BUILD_SHA || 'dev';
		out.floppy = p.reachable
			? { reachable: true, version: p.version, timezone: p.timezone }
			: { reachable: false, error: p.floppyError };
		if (p.reachable && p.tokenAccepted !== undefined) {
			out.token = p.tokenAccepted ? 'accepted' : 'rejected';
			if (!p.tokenAccepted) out.error = p.tokenError;
		}
	}

	return json(out, { status: p.httpStatus });
};
