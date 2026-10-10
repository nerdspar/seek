import { json, error } from '@sveltejs/kit';
import { setAnimeOverride } from '$lib/server/anime-sync';
import { expire } from '$lib/server/memo';
import type { RequestHandler } from './$types';

/**
 * Overrule Seek's anime rule for one show: `{ mediaId, anime: true | false }`.
 * The household's answer, so it files the show for everyone at once.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
	const me = locals.user;
	if (!me) error(401);
	const { mediaId, anime } = await request.json().catch(() => ({}));
	if (typeof mediaId !== 'string' || !mediaId || typeof anime !== 'boolean') error(400, 'mediaId and anime are required');
	setAnimeOverride(me.householdId, me.id, mediaId, anime);
	expire('watchlist:');
	expire('library:');
	expire('collection:');
	expire('stats:');
	return json({ anime });
};
