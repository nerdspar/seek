/**
 * Short-lived memoisation for server loads, with in-flight de-duplication.
 *
 * Floppy is authoritative and Seek holds no watch state, so caching here only
 * ever delays *seeing* a change, never causes one. That matters because some of
 * its endpoints are genuinely expensive: /api/v1/statistics/overview/ takes
 * 9.4s and returns 501 KB for an all-time range, which is what made the Profile
 * tab feel broken rather than slow.
 *
 * Anything Seek writes must invalidate the relevant key — see invalidate().
 */
type Entry<T> = { at: number; value: T };

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
	const hit = store.get(key) as Entry<T> | undefined;
	if (hit && Date.now() - hit.at < ttlMs) return hit.value;

	const running = inflight.get(key) as Promise<T> | undefined;
	if (running) return running;

	const promise = load()
		.then((value) => {
			store.set(key, { at: Date.now(), value });
			return value;
		})
		.catch((err) => {
			// Serve stale rather than an error page if we have anything at all.
			if (hit) return hit.value;
			throw err;
		})
		.finally(() => inflight.delete(key));

	inflight.set(key, promise);
	return promise;
}

/** Drops every entry whose key starts with `prefix`. */
export function invalidate(prefix: string): void {
	for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}
