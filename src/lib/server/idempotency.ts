/**
 * Server-side idempotency for append-style writes.
 *
 * The offline queue attaches an `Idempotency-Key` to every write and replays it
 * on reconnect ($lib/queue). Floppy's watch POST *appends* a play rather than
 * upserting, so replaying a request that already landed — the classic
 * "committed, but the response never made it back" case, and now also the parked
 * 503 — would record a second play. This remembers the keys whose write has
 * landed and lets a handler skip the mutation on a repeat, turning a replay into
 * a no-op instead of a duplicate.
 *
 * In memory and process-local on purpose: the window that matters is a single
 * reconnect, and a key that outlives a restart is not worth persisting. Bounded
 * so a flood of distinct keys cannot grow it without limit.
 */
const TTL_MS = 15 * 60 * 1000;
const MAX = 5000;

/** key → expiry timestamp. Insertion order is oldest-first, used for eviction. */
const seen = new Map<string, number>();

function sweep(now: number): void {
	if (seen.size < MAX) return;
	for (const [k, exp] of seen) if (exp < now) seen.delete(k);
	// Still full of live keys: drop the oldest by insertion order.
	if (seen.size >= MAX) {
		const excess = seen.size - MAX + 1;
		let i = 0;
		for (const k of seen.keys()) {
			if (i++ >= excess) break;
			seen.delete(k);
		}
	}
}

/** True if this key's write has already been applied within the TTL. */
export function alreadyApplied(key: string | null | undefined): boolean {
	if (!key) return false;
	const exp = seen.get(key);
	if (exp === undefined) return false;
	if (exp < Date.now()) {
		seen.delete(key);
		return false;
	}
	return true;
}

/** Record that a key's write has landed, so a later replay is skipped. Call
 *  this only after the mutation actually succeeds — a failed write must stay
 *  retryable. */
export function markApplied(key: string | null | undefined): void {
	if (!key) return;
	const now = Date.now();
	sweep(now);
	seen.set(key, now + TTL_MS);
}
