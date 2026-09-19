import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getInfo, whoami } from '$lib/server/api';
import type { RequestHandler } from './$types';

/**
 * Step 1 health check: is Floppy up, and is our token actually accepted?
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
let cache: { at: number; probe: Probe } | null = null;

async function runProbe(): Promise<Probe> {
	try {
		const info = await getInfo();
		try {
			await whoami();
			return {
				httpStatus: 200,
				ok: true,
				reachable: true,
				version: info.version,
				timezone: info.timezone,
				tokenAccepted: true
			};
		} catch (err) {
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

async function probe(): Promise<Probe> {
	if (cache && Date.now() - cache.at < PROBE_TTL) return cache.probe;
	const p = await runProbe();
	cache = { at: Date.now(), probe: p };
	return p;
}

export const GET: RequestHandler = async ({ locals }) => {
	const detail = locals.authed;
	const p = await probe();

	const out: Record<string, unknown> = { ok: p.ok };
	// The commit this build came from — reported even if Floppy is down, since
	// "which version am I running?" is exactly what you ask when things look off.
	if (detail) {
		out.build = env.SEEK_BUILD_SHA || 'dev';
		out.floppy = p.reachable
			? { reachable: true, version: p.version, timezone: p.timezone }
			: { reachable: false, error: p.floppyError };
		if (p.reachable) {
			out.token = p.tokenAccepted ? 'accepted' : 'rejected';
			if (!p.tokenAccepted) out.error = p.tokenError;
		}
	}

	return json(out, { status: p.httpStatus });
};
