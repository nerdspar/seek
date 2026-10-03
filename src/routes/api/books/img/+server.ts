import { error } from '@sveltejs/kit';
import { allowedRemote, cachedThumbnail, imageHeaders, snapWidth } from '$lib/server/images';
import type { RequestHandler } from './$types';

/**
 * A Hardcover cover as a small WebP thumbnail. Hardcover only serves the full
 * original (~640 KB) and its CDN ignores size parameters, so Seek shrinks it
 * once and caches it. Only Hardcover's asset host is accepted — this must never
 * become an open fetch-anything proxy.
 */
export const GET: RequestHandler = async ({ url }) => {
	const src = allowedRemote(url.searchParams.get('u') ?? '');
	if (!src) error(400, 'Not an allowed image URL.');
	const width = snapWidth(url.searchParams.get('w'));
	const thumb = await cachedThumbnail(`hc:${src.href}`, width, () =>
		fetch(src, { signal: AbortSignal.timeout(15_000) })
	);
	if (!thumb) error(404, 'Cover unavailable.');
	return new Response(new Uint8Array(thumb), { headers: imageHeaders('public') });
};
