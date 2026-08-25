/**
 * Server-load cache with stale-while-revalidate.
 *
 * The rule this enforces: **a request never waits for work it could serve from
 * cache.** Rebuilding the watchlist costs ~3.7s (a 2.3s list query plus an
 * 88-way episode-title fan-out), and paying that on a tap is what made the app
 * feel like it hung. So a stale entry is served immediately and refreshed behind
 * the response; only a genuinely cold key blocks.
 *
 * Safe because Floppy is authoritative and Seek stores no watch state: a stale
 * read can lag reality by seconds, never corrupt it. Writes update the affected
 * entry in place (see patch) rather than dropping it, so marking an episode does
 * not throw away the list it just updated.
 */
type Entry<T> = { at: number; value: T; refreshing: boolean };

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function run<T>(key: string, load: () => Promise<T>): Promise<T> {
	const existing = inflight.get(key) as Promise<T> | undefined;
	if (existing) return existing;

	const promise = load()
		.then((value) => {
			store.set(key, { at: Date.now(), value, refreshing: false });
			return value;
		})
		.catch((err) => {
			const stale = store.get(key) as Entry<T> | undefined;
			if (stale) {
				// Keep serving what we have; a failed refresh must not empty a tab.
				stale.refreshing = false;
				return stale.value;
			}
			throw err;
		})
		.finally(() => inflight.delete(key));

	inflight.set(key, promise);
	return promise;
}

export async function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
	const hit = store.get(key) as Entry<T> | undefined;

	if (hit) {
		const age = Date.now() - hit.at;
		if (age >= ttlMs && !hit.refreshing) {
			hit.refreshing = true;
			// Deliberately not awaited: the caller gets the stale value now.
			void run(key, load);
		}
		return hit.value;
	}

	return run(key, load);
}

/** Replace a cached value without going back to Floppy. */
export function put<T>(key: string, value: T): void {
	store.set(key, { at: Date.now(), value, refreshing: false });
}

/** Rewrite every entry under a prefix. Used after a write so the list reflects
 *  the change immediately without a rebuild. */
export function patch<T>(prefix: string, update: (value: T) => T): void {
	for (const [key, entry] of store) {
		if (!key.startsWith(prefix)) continue;
		try {
			(entry as Entry<T>).value = update(entry.value as T);
		} catch {
			// A patch that cannot apply just leaves the entry to expire normally.
		}
	}
}

/** Mark entries stale so the next read refreshes them in the background,
 *  without discarding what they hold. */
export function expire(prefix: string): void {
	for (const [key, entry] of store) {
		if (key.startsWith(prefix)) entry.at = 0;
	}
}

/** Hard drop. Only for data that would be actively wrong if served stale. */
export function invalidate(prefix: string): void {
	for (const key of [...store.keys()]) if (key.startsWith(prefix)) store.delete(key);
}
