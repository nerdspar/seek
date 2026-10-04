import { json, error } from '@sveltejs/kit';
import { mirroringAvailable, newShowDeps } from '$lib/server/household/run';
import { decide, isMode, newShowsMode, pendingShows, setNewShowsMode } from '$lib/server/household/newShows';
import type { RequestHandler } from './$types';

/** Together or solo for new shows: the setting and the shows waiting for an answer. */
export const GET: RequestHandler = async ({ locals }) => {
	const me = locals.user;
	if (!me) error(401);
	const mirroring = mirroringAvailable(me.householdId);
	return json({
		mirroring,
		mode: newShowsMode(me.householdId),
		pending: mirroring ? pendingShows(me.householdId) : []
	});
};

/** Change the household's setting for new shows. */
export const PUT: RequestHandler = async ({ locals, request }) => {
	const me = locals.user;
	if (!me) error(401);
	const { mode } = await request.json().catch(() => ({}));
	if (!isMode(mode)) error(400, 'mode must be ask, together or solo');
	setNewShowsMode(me.householdId, mode);
	return json({ mode });
};

/** Answer for one show: `{ source, mediaId, title?, choice: 'together' | 'solo' }`. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const me = locals.user;
	if (!me) error(401);
	if (!mirroringAvailable(me.householdId)) error(409, 'Sharing starts once two of you have Floppy linked.');
	const b = await request.json().catch(() => ({}));
	if (typeof b.source !== 'string' || typeof b.mediaId !== 'string' || (b.choice !== 'together' && b.choice !== 'solo')) {
		error(400, 'source, mediaId and a choice of together or solo are required');
	}
	const show = { source: b.source, mediaId: b.mediaId, title: typeof b.title === 'string' ? b.title : null };
	decide(me.householdId, me.id, show, b.choice, newShowDeps);
	return json({ ok: true, pending: pendingShows(me.householdId) });
};
