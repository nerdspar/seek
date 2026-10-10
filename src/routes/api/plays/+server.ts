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

/** Remove one play from the history: `{ id }`. Yours only. */
export const DELETE: RequestHandler = async ({ request }) => {
	const me = currentUser();
	if (!me) error(401);
	const { id } = await request.json().catch(() => ({}));
	if (!Number.isInteger(id)) error(400, 'id is required');
	const gone = removePlay(me.id, id);
	if (!gone) error(404, 'No such play');
	expire('watchlist:');
	expire('library:');
	expire('stats:');
	expire('collection:');
	invalidate(`tracking:${gone.kind}:tmdb:${gone.tmdbId}`);
	return json({ ok: true });
};
