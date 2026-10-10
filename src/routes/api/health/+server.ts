import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

/**
 * Health check: can Seek read its own database? Everything Seek shows lives
 * there now, so that's the whole question — another service being down is not
 * Seek being down.
 *
 * Reachable without a session, because the container's HEALTHCHECK has no way to
 * hold one — see the note in hooks.server.ts. The status code carries the whole
 * signal; the build is only told to a signed-in caller.
 */
export const GET: RequestHandler = async ({ locals }) => {
	let ok = true;
	try {
		db().prepare('SELECT 1').get();
	} catch {
		ok = false;
	}
	const out: Record<string, unknown> = { ok };
	if (locals.authed) out.build = env.SEEK_BUILD_SHA || 'dev';
	return json(out, { status: ok ? 200 : 503 });
};
