import { json, error } from '@sveltejs/kit';
import { listShared } from '$lib/server/household/shared';
import { mirrorMembers } from '$lib/server/household/mirror';
import { setShared, syncJointTags } from '$lib/server/household/run';
import { listMembers } from '$lib/server/users';
import type { RequestHandler } from './$types';

/** The household's shared shows, and whether mirroring can run yet. */
export const GET: RequestHandler = async ({ locals }) => {
	const me = locals.user;
	if (!me) error(401);
	const linked = new Set(mirrorMembers(me.householdId).map((m) => m.id));
	return json({
		// Who still needs to link Floppy before plays can mirror.
		waitingOn: listMembers(me.householdId)
			.filter((m) => !linked.has(m.id))
			.map((m) => (m.id === me.id ? 'you' : m.name)),
		mirroring: linked.size >= 2,
		shows: listShared(me.householdId)
	});
};

/** Stop sharing a show (plays already carried over stay). */
export const DELETE: RequestHandler = async ({ locals, request }) => {
	const me = locals.user;
	if (!me) error(401);
	const { source, mediaId } = await request.json().catch(() => ({}));
	if (typeof source !== 'string' || typeof mediaId !== 'string') error(400, 'source and mediaId are required');
	setShared(me.householdId, me.id, { source, mediaId }, false);
	await syncJointTags(me.householdId, { source, mediaId }, false);
	return json({ ok: true });
};
