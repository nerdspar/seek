import { json, error } from '@sveltejs/kit';
import { currentUser } from '$lib/server/userctx';
import { seekDiaryOffset } from '$lib/server/tracking/stats';
import type { RequestHandler } from './$types';

/** The diary offset whose page holds a given date (the diary pages by days with plays). */
export const GET: RequestHandler = async ({ url }) => {
	const date = (url.searchParams.get('date') ?? '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(400, 'date must be YYYY-MM-DD');
	const me = currentUser();
	if (!me) error(401);
	return json({ offset: seekDiaryOffset(me.id, date) });
};
