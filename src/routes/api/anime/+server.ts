import { json, error } from '@sveltejs/kit';
import { classifyShow, setAnimeOverride } from '$lib/server/anime-sync';
import { mirrorMembers } from '$lib/server/household/mirror';
import { runAs } from '$lib/server/userctx';
import type { RequestHandler } from './$types';

/**
 * Overrule Floppy's genre for one show: `{ mediaId, anime: true | false }`. The
 * household's answer, so everyone's tag follows — yours at once, the others'
 * best-effort here (and the six-hourly pass catches anyone missed).
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
	const me = locals.user;
	if (!me) error(401);
	const { mediaId, anime } = await request.json().catch(() => ({}));
	if (typeof mediaId !== 'string' || !mediaId || typeof anime !== 'boolean') error(400, 'mediaId and anime are required');

	setAnimeOverride(me.householdId, me.id, mediaId, anime);
	const now = await classifyShow(mediaId);
	for (const m of mirrorMembers(me.householdId)) {
		if (m.id !== me.id) await runAs(m, () => classifyShow(mediaId));
	}
	return json({ anime: now ?? anime });
};
