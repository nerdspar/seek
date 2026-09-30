import { describe, it, expect, vi } from 'vitest';
import { memo, put, patch, expire, invalidate } from './memo';

const flush = () => new Promise((r) => setTimeout(r, 0));
let n = 0;
const key = (p: string) => `${p}:${n++}`; // unique per test; memo store is module-global

describe('memo (stale-while-revalidate)', () => {
	it('blocks on a cold key, then serves the cached value without reloading', async () => {
		const k = key('cold');
		const load = vi.fn().mockResolvedValue('A');
		expect(await memo(k, 10_000, load)).toBe('A');
		expect(await memo(k, 10_000, load)).toBe('A');
		expect(load).toHaveBeenCalledTimes(1); // second read is a fresh hit
	});

	it('serves the stale value immediately and refreshes in the background', async () => {
		const k = key('stale');
		expect(await memo(k, 0, vi.fn().mockResolvedValue('A'))).toBe('A');
		// ttl 0 ⇒ the next read is stale: it returns A now and kicks off a refresh.
		const load2 = vi.fn().mockResolvedValue('B');
		expect(await memo(k, 0, load2)).toBe('A');
		await flush();
		expect(load2).toHaveBeenCalledTimes(1);
		expect(await memo(k, 10_000, vi.fn())).toBe('B'); // refresh landed
	});

	it('keeps serving the last good value when a refresh fails', async () => {
		const k = key('fail');
		expect(await memo(k, 0, vi.fn().mockResolvedValue('A'))).toBe('A');
		expect(await memo(k, 0, vi.fn().mockRejectedValue(new Error('down')))).toBe('A');
		await flush();
		expect(await memo(k, 10_000, vi.fn())).toBe('A');
	});

	it('gives each distinct key its own value', async () => {
		const a = key('k');
		const b = key('k');
		expect(await memo(a, 10_000, vi.fn().mockResolvedValue(1))).toBe(1);
		expect(await memo(b, 10_000, vi.fn().mockResolvedValue(2))).toBe(2);
		expect(await memo(a, 10_000, vi.fn())).toBe(1);
	});
});

describe('memo mutators', () => {
	it('put replaces a value directly', async () => {
		const k = key('put');
		put(k, 'X');
		expect(await memo(k, 10_000, vi.fn())).toBe('X');
	});

	it('patch rewrites matching entries in place', async () => {
		const k = key('list:');
		await memo(k, 10_000, vi.fn().mockResolvedValue([1, 2]));
		patch<number[]>('list:', (v) => [...v, 3]);
		expect(await memo(k, 10_000, vi.fn())).toEqual([1, 2, 3]);
	});

	it('expire marks stale so the next read refreshes', async () => {
		const k = key('exp');
		await memo(k, 10_000, vi.fn().mockResolvedValue('old'));
		expire('exp');
		const load = vi.fn().mockResolvedValue('new');
		expect(await memo(k, 10_000, load)).toBe('old'); // stale served
		await flush();
		expect(load).toHaveBeenCalledTimes(1);
		expect(await memo(k, 10_000, vi.fn())).toBe('new');
	});

	it('invalidate hard-drops, forcing a blocking reload', async () => {
		const k = key('inv');
		await memo(k, 10_000, vi.fn().mockResolvedValue('gone'));
		invalidate('inv');
		const load = vi.fn().mockResolvedValue('rebuilt');
		expect(await memo(k, 10_000, load)).toBe('rebuilt');
		expect(load).toHaveBeenCalledTimes(1);
	});
});
