import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { snapWidth, allowedRemote, thumbnail, cachedThumbnail } from './images';

const jpeg = (w: number, h: number) =>
	sharp({ create: { width: w, height: h, channels: 3, background: '#5b6cff' } }).jpeg().toBuffer();

describe('snapWidth', () => {
	it('snaps up to the ladder, defaulting and capping', () => {
		expect(snapWidth(100)).toBe(120);
		expect(snapWidth('220')).toBe(240);
		expect(snapWidth(5000)).toBe(360);
		expect(snapWidth('nope')).toBe(240);
		expect(snapWidth(-3)).toBe(240);
	});
});

describe('allowedRemote', () => {
	it('only lets Hardcover asset URLs through (no open proxy)', () => {
		expect(allowedRemote('https://assets.hardcover.app/edition/1/x.jpg')?.hostname).toBe('assets.hardcover.app');
		expect(allowedRemote('http://assets.hardcover.app/x.jpg')).toBeNull(); // not https
		expect(allowedRemote('https://10.0.1.14:8007/admin')).toBeNull();
		expect(allowedRemote('https://assets.hardcover.app.evil.com/x.jpg')).toBeNull();
		expect(allowedRemote('https://user:pw@assets.hardcover.app/x.jpg')).toBeNull();
		expect(allowedRemote('not a url')).toBeNull();
	});
});

describe('thumbnail', () => {
	it('shrinks to the width as WebP, keeping the aspect ratio', async () => {
		const out = await thumbnail(await jpeg(1200, 1800), 240);
		const meta = await sharp(out).metadata();
		expect(meta).toMatchObject({ format: 'webp', width: 240, height: 360 });
	});

	it('never enlarges a small cover', async () => {
		const meta = await sharp(await thumbnail(await jpeg(100, 150), 360)).metadata();
		expect(meta.width).toBe(100);
	});
});

describe('cachedThumbnail', () => {
	it('fetches the original once, then serves the cached thumbnail', async () => {
		const original = await jpeg(800, 1200);
		const fetchOriginal = vi.fn(async () => new Response(new Uint8Array(original)));
		const a = await cachedThumbnail('k1', 120, fetchOriginal);
		const b = await cachedThumbnail('k1', 120, fetchOriginal);
		expect(a).not.toBeNull();
		expect(b).toBe(a);
		expect(fetchOriginal).toHaveBeenCalledTimes(1);
	});

	it('returns null for a failed fetch or a non-image', async () => {
		expect(await cachedThumbnail('k2', 120, async () => new Response('', { status: 404 }))).toBeNull();
		expect(await cachedThumbnail('k3', 120, async () => new Response('<html>not an image</html>'))).toBeNull();
	});
});
