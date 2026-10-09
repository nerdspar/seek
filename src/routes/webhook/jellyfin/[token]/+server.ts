import { json } from '@sveltejs/kit';
import { userByJellyfinToken } from '$lib/server/users';
import { runAs } from '$lib/server/userctx';
import { handleJellyfin } from '$lib/server/tracking/jellyfin';
import type { RequestHandler } from './$types';

/** Jellyfin's webhook plugin posts here (own-tracking plan, step 4). The token in
 *  the URL says whose plays these are, the way Floppy's webhook URL does. */
export const POST: RequestHandler = async ({ params, request }) => {
	const user = userByJellyfinToken(params.token);
	if (!user) return new Response('Unknown webhook', { status: 404 });
	const payload = await request.json().catch(() => null);
	if (!payload) return new Response('Expected JSON', { status: 400 });
	try {
		return json(await runAs(user, () => handleJellyfin(user, payload)));
	} catch (err) {
		console.warn(`[webhook] user ${user.id}:`, err);
		// Jellyfin doesn't retry usefully; say it arrived, keep the failure in the log.
		return json({ ok: false });
	}
};
