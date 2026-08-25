import { json } from '@sveltejs/kit';
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
export const GET: RequestHandler = async ({ locals }) => {
	const detail = locals.authed;
	const out: Record<string, unknown> = { ok: false };

	try {
		const info = await getInfo();
		if (detail) out.floppy = { reachable: true, version: info.version, timezone: info.timezone };
	} catch (err) {
		if (detail) out.floppy = { reachable: false, error: String(err) };
		return json(out, { status: 503 });
	}

	try {
		await whoami();
		if (detail) out.token = 'accepted';
		out.ok = true;
	} catch (err) {
		if (detail) {
			out.token = 'rejected';
			out.error = String(err);
		}
		return json(out, { status: 503 });
	}

	return json(out);
};
