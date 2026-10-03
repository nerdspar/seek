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
 *
 * Every key is namespaced to the current user (userctx), transparently: callers
 * keep writing `watchlist:tv:…`, and two people's watchlists live side by side
 * as `u1:watchlist:…` / `u2:watchlist:…`. That is what makes one shared cache
 * safe in a multi-user Seek — nothing can be served across accounts.
 */
import { scopeKey, unscoped } from './userctx';

type Entry<T> = { at: number; value: T; refreshing: boolean };

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/* The store is otherwise unbounded: per-item keys (show:/movie:/extras:/
   tracking:) accumulate one entry per title ever opened. This caps it. The
   warmed, bounded hot set is never evicted — dropping the launch screen to make
   room for a detail page would trade a cheap key for an expensive rebuild. */
const MAX_ENTRIES = 1500;
const PROTECTED = ['watchlist:', 'stats:', 'collection:', 'discover:', 'upcoming:', 'services:', 'tracked:', 'library:'];

function evictIfNeeded(): void {
	if (store.size <= MAX_ENTRIES) return;
	// Drop the least-recently-refreshed evictable entry.
	let oldestKey: string | undefined;
	let oldestAt = Infinity;
	for (const [k, e] of store) {
		if (PROTECTED.some((p) => unscoped(k).startsWith(p))) continue;
		if (e.at < oldestAt) {
			oldestAt = e.at;
			oldestKey = k;
		}
	}
	if (oldestKey !== undefined) store.delete(oldestKey);
}

function run<T>(key: string, load: () => Promise<T>): Promise<T> {
	const existing = inflight.get(key) as Promise<T> | undefined;
	if (existing) return existing;

	const promise = load()
		.then((value) => {
			store.set(key, { at: Date.now(), value, refreshing: false });
			evictIfNeeded();
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

export async function memo<T>(rawKey: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
	const key = scopeKey(rawKey);
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
	store.set(scopeKey(key), { at: Date.now(), value, refreshing: false });
	evictIfNeeded();
}

/** Rewrite every entry under a prefix. Used after a write so the list reflects
 *  the change immediately without a rebuild. The full cache key is passed so a
 *  patch can act differently per filter variant — a row that a mark pushes out
 *  of the in-progress backlog must be dropped from those entries, not just
 *  updated in place. */
export function patch<T>(prefix: string, update: (value: T, key: string) => T): void {
	const scoped = scopeKey(prefix);
	for (const [key, entry] of store) {
		if (!key.startsWith(scoped)) continue;
		try {
			// Callers see the key they wrote (unscoped), as before.
			(entry as Entry<T>).value = update(entry.value as T, unscoped(key));
		} catch {
			// A patch that cannot apply just leaves the entry to expire normally.
		}
	}
}

/** Mark entries stale so the next read refreshes them in the background,
 *  without discarding what they hold. */
export function expire(prefix: string): void {
	const scoped = scopeKey(prefix);
	for (const [key, entry] of store) {
		if (key.startsWith(scoped)) entry.at = 0;
	}
}

/** Hard drop. Only for data that would be actively wrong if served stale. */
export function invalidate(prefix: string): void {
	const scoped = scopeKey(prefix);
	for (const key of [...store.keys()]) if (key.startsWith(scoped)) store.delete(key);
}

/** Hard drop for *every* user — for writes that change what someone else sees
 *  (e.g. a mirrored play on a shared show, or a household-wide setting). */
export function invalidateEveryone(prefix: string): void {
	for (const key of [...store.keys()]) if (unscoped(key).startsWith(prefix)) store.delete(key);
}
