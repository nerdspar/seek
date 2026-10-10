import { json, error } from '@sveltejs/kit';
import { expire, invalidate } from '$lib/server/memo';
import { currentUser } from '$lib/server/userctx';
import { playsOf, removePlay, tmdbIdOf } from '$lib/server/tracking/write';
import type { RequestHandler } from './$types';

const int = (v: string | null) => (v !== null && /^\d+$/.test(v) ? Number(v) : null);

/** Your plays of an episode (`season` + `episode`), a season (`season`), or a
 *  film (`type=movie`), newest first — the long-press menu's history. */
export const GET: RequestHandler = async ({ url }) => {
	const me = currentUser();
	if (!me) error(401);
	const kind = url.searchParams.get('type') === 'movie' ? 'movie' : 'tv';
	const tmdbId = tmdbIdOf(url.searchParams.get('source') ?? 'tmdb', url.searchParams.get('mediaId') ?? '');
	if (tmdbId === null) error(400, 'mediaId is required');
	const season = int(url.searchParams.get('season'));
	const episode = int(url.searchParams.get('episode'));
	if (kind === 'tv' && season === null) error(400, 'season is required');
	return json({ plays: playsOf(me.id, kind, tmdbId, kind === 'tv' ? season : null, kind === 'tv' ? episode : null) });
};

/** Remove plays from the history: `{ id }`, or `{ ids }` (a season's plays
 *  from one day — undoing a whole-season "watched again"). Yours only. */
export const DELETE: RequestHandler = async ({ request }) => {
	const me = currentUser();
	if (!me) error(401);
	const body = await request.json().catch(() => ({}));
	const ids: unknown[] = Array.isArray(body.ids) ? body.ids : [body.id];
	if (!ids.length || ids.length > 500 || !ids.every((i) => Number.isInteger(i))) error(400, 'id or ids is required');
	const removed = (ids as number[]).map((i) => removePlay(me.id, i)).filter((g) => g !== null);
	if (!removed.length) error(404, 'No such play');
	const gone = removed[0];
	expire('watchlist:');
	expire('library:');
	expire('stats:');
	expire('collection:');
	invalidate(`tracking:${gone.kind}:tmdb:${gone.tmdbId}`);
	return json({ ok: true, removed: removed.length });
};
