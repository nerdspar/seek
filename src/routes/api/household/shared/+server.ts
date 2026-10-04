import { json, error } from '@sveltejs/kit';
import { listShared } from '$lib/server/household/shared';
import { mirrorMembers } from '$lib/server/household/mirror';
import { bulkProgress, mirroringAvailable, setShared, shareMany, syncJointTags } from '$lib/server/household/run';
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
		shows: listShared(me.householdId),
		bulk: bulkProgress(me.householdId)
	});
};

/**
 * Share many shows at once (the joint import): `{ shows: [{source, mediaId,
 * title?}] }`. Catch-up runs in the background; GET reports its progress.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const me = locals.user;
	if (!me) error(401);
	if (!mirroringAvailable(me.householdId)) error(409, 'Sharing starts once two of you have Floppy linked.');
	const body = await request.json().catch(() => ({}));
	const raw: unknown[] = Array.isArray(body.shows) ? body.shows : [];
	const shows = raw
		.map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>) : {}))
		.filter((s) => typeof s.source === 'string' && typeof s.mediaId === 'string' && s.source && s.mediaId)
		.map((s) => ({ source: s.source as string, mediaId: s.mediaId as string, title: typeof s.title === 'string' ? s.title : null }));
	if (!shows.length || shows.length !== raw.length) error(400, 'Every show needs a source and mediaId.');
	if (shows.length > 1000) error(400, 'At most 1000 shows at a time.');
	if (bulkProgress(me.householdId)?.running) error(409, 'A bulk share is already running.');
	return json({ bulk: shareMany(me.householdId, me.id, shows) });
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
