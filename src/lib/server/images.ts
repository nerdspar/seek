/**
 * Cover thumbnails. Neither book source serves sized images: Hardcover hands out
 * the original edition scan (~640 KB, up to ~1900 px wide) and BookOrbit its
 * stored cover (~150 KB) — for tiles drawn 52–110 px wide. On a phone a single
 * Discover visit was tens of megabytes. Seek fetches each cover once, shrinks it
 * to the size the tile actually draws (2× for retina) as WebP — a few KB — and
 * caches the result; the browser and service worker then keep it.
 */
import sharp from 'sharp';
import { TTLCache } from './cache';

/** The only widths handed out. A fixed ladder keeps the cache small and stops a
 *  caller from asking the server to render arbitrary sizes. */
export const WIDTHS = [120, 240, 360] as const;
export type Width = (typeof WIDTHS)[number];

/** Snap a requested width to the smallest ladder step that covers it. */
export function snapWidth(raw: unknown): Width {
	const w = Number(raw);
	if (!Number.isFinite(w) || w <= 0) return 240;
	return WIDTHS.find((s) => s >= w) ?? WIDTHS[WIDTHS.length - 1];
}

/* Remote covers Seek will fetch on the browser's behalf. Anything else is
   refused — an open "fetch this URL for me" endpoint is an SSRF handle into the
   LAN. */
const REMOTE_HOSTS = new Set(['assets.hardcover.app']);

export function allowedRemote(raw: string): URL | null {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return null;
	}
	return u.protocol === 'https:' && REMOTE_HOSTS.has(u.hostname) && !u.username && !u.password ? u : null;
}

export async function thumbnail(input: Buffer, width: Width): Promise<Buffer> {
	return sharp(input, { failOn: 'none' })
		.rotate() // honour EXIF orientation before it's stripped
		.resize({ width, withoutEnlargement: true })
		.webp({ quality: 72 })
		.toBuffer();
}

/* ~10–20 KB per thumbnail; 600 of them is a few MB of memory. Covers don't
   change, so a long life is fine — a cold cache only costs a re-fetch. */
const cache = new TTLCache<Buffer>(7 * 24 * 60 * 60 * 1000, 600);

/** A cached thumbnail for `key`, built from `fetchOriginal` on a miss. Null when
 *  the original can't be fetched or isn't an image. */
export async function cachedThumbnail(
	key: string,
	width: Width,
	fetchOriginal: () => Promise<Response>
): Promise<Buffer | null> {
	const k = `${width}:${key}`;
	const hit = cache.get(k);
	if (hit) return hit;
	const res = await fetchOriginal();
	if (!res.ok) return null;
	try {
		const out = await thumbnail(Buffer.from(await res.arrayBuffer()), width);
		cache.set(k, out);
		return out;
	} catch {
		return null; // not a decodable image
	}
}

/** Long-lived: a cover never changes, and the URL carries the width. `private`
 *  for anything from someone's own library. */
export function imageHeaders(scope: 'public' | 'private'): Record<string, string> {
	return {
		'Content-Type': 'image/webp',
		'Cache-Control': `${scope}, max-age=2592000, immutable`
	};
}
