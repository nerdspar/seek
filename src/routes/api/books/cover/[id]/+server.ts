import { error } from '@sveltejs/kit';
import { fetchCover } from '$lib/server/books/bookorbit';
import { cachedThumbnail, imageHeaders, snapWidth } from '$lib/server/images';
import { scopeKey } from '$lib/server/userctx';
import type { RequestHandler } from './$types';

/**
 * A book cover from BookOrbit, as a small WebP thumbnail (`?w=` snaps to the
 * size ladder). BookOrbit covers need a signed-in session, so the browser can't
 * load them directly — Seek fetches them as you (your BookOrbit login), shrinks
 * them, and caches the result per user (so separate libraries can't leak a
 * cover across accounts). Private caching: it's your library.
 */
export const GET: RequestHandler = async ({ params, url }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad book id.');
	const width = snapWidth(url.searchParams.get('w'));
	const thumb = await cachedThumbnail(scopeKey(`bo:${id}`), width, () => fetchCover(id));
	if (!thumb) error(404, 'Cover unavailable.');
	return new Response(new Uint8Array(thumb), { headers: imageHeaders('private') });
};
