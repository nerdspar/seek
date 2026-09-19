/**
 * Durable write queue — actions reach Floppy eventually, even offline.
 *
 * Every write in Seek is optimistic: the UI updates first, then the request
 * goes out. Online, nothing changes — the request lands and we move on. Offline
 * (or when the request throws), the action is parked in IndexedDB and the
 * optimistic state stands; it is replayed the next time we are online and the
 * app is open. iOS PWAs have no Background Sync, so "eventually" honestly means
 * "next time you open Seek with a connection" — which is what this drains on.
 *
 * The queue holds at most ONE action per target. A second write to the same
 * target replaces the first (latest intent wins), and an action that undoes an
 * unsent one (mark then unmark the same episode) cancels both. That is what
 * makes replay safe without trusting the network: the queue can only ever
 * describe the net result, so a flush cannot double-apply. An idempotency key
 * rides along too, for the server paths that honour it.
 *
 * Client-only: every entry point no-ops during SSR.
 */

type Op = 'set' | 'add' | 'remove';

type Queued = {
	target: string; // one pending action per target
	op: Op; // 'add'/'remove' cancel each other; 'set' just replaces
	url: string;
	method: string;
	body: string | null;
	key: string; // idempotency key
	at: number;
};

const DB = 'seek-queue';
const STORE = 'writes';
const browser = typeof indexedDB !== 'undefined';

let pending = $state<Queued[]>([]);
let flushing = false;

/** Reactive count of un-synced actions, for a UI indicator. */
export const pendingCount = () => pending.length;

function idb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'target' });
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function tx(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => void): Promise<void> {
	const db = await idb();
	return new Promise((resolve, reject) => {
		const t = db.transaction(STORE, mode);
		fn(t.objectStore(STORE));
		t.oncomplete = () => resolve();
		t.onerror = () => reject(t.error);
	});
}

const opposes = (a: Op, b: Op) =>
	(a === 'add' && b === 'remove') || (a === 'remove' && b === 'add');

/**
 * Try a write; if it cannot be sent, queue it and report success so the
 * optimistic UI stands. A returned Response with status 202 means "queued".
 */
export async function queuedWrite(
	target: string,
	op: Op,
	url: string,
	init: RequestInit
): Promise<Response> {
	const method = (init.method ?? 'GET').toUpperCase();
	const key = crypto.randomUUID();
	const headers = new Headers(init.headers);
	headers.set('Idempotency-Key', key);

	const store = () =>
		park({
			target,
			op,
			url,
			method,
			body: typeof init.body === 'string' ? init.body : null,
			key,
			at: Date.now()
		});

	try {
		const res = await fetch(url, { ...init, headers });
		/* 503 is the write endpoints' "Floppy unreachable, nothing was recorded"
		   signal (see /api/watch, /api/season). The device is online but the
		   backing store is not, so this is exactly the offline case the queue
		   exists for — park it and replay later rather than rolling the user back.
		   Safe against double-apply because a 503 means nothing landed. Any other
		   response — success or a real error — is the server's answer; hand it back
		   and let the caller decide (they roll back on !ok as before). */
		if (res.status === 503 && browser) {
			await store();
			return new Response(JSON.stringify({ queued: true }), {
				status: 202,
				headers: { 'content-type': 'application/json' }
			});
		}
		return res;
	} catch {
		// Network failure / offline: park it and tell the caller it's handled.
		if (browser) await store();
		return new Response(JSON.stringify({ queued: true }), {
			status: 202,
			headers: { 'content-type': 'application/json' }
		});
	}
}

async function park(entry: Queued) {
	const existing = pending.find((p) => p.target === entry.target);
	if (existing && opposes(existing.op, entry.op)) {
		// The action cancels an unsent one: drop both, the net effect is nothing.
		await tx('readwrite', (s) => s.delete(entry.target));
		pending = pending.filter((p) => p.target !== entry.target);
		return;
	}
	// Otherwise this is the latest intent for the target — replace.
	await tx('readwrite', (s) => s.put(entry));
	pending = [...pending.filter((p) => p.target !== entry.target), entry];
}

/** Replay parked actions in order. Stops on the first network failure (still
 *  offline) so order is preserved; drops actions the server rejects for good. */
export async function flush(): Promise<void> {
	if (!browser || flushing || !pending.length || !navigator.onLine) return;
	flushing = true;
	try {
		for (const entry of [...pending].sort((a, b) => a.at - b.at)) {
			try {
				const res = await fetch(entry.url, {
					method: entry.method,
					headers: { 'Content-Type': 'application/json', 'Idempotency-Key': entry.key },
					body: entry.body ?? undefined
				});
				if (res.ok || (res.status >= 400 && res.status < 500)) {
					// Done, or permanently rejected (a 4xx will never succeed on
					// retry) — either way it leaves the queue. A 404/409 here is a
					// stale action against state that already moved on.
					await dropIfCurrent(entry.target, entry.key);
				} else {
					break; // 5xx: server is up but unhappy; try again later.
				}
			} catch {
				break; // still offline — keep the rest for next time.
			}
		}
	} finally {
		flushing = false;
	}
}

/**
 * Remove a target's entry only if it is still the one we just sent.
 *
 * `flush` awaits the network between reading an entry and dropping it. If the
 * user re-acts on the same target during that await, `park` replaces the row
 * with a newer intent (same target, new key). Deleting by target alone would
 * throw that newer action away — sent by neither this flush nor a later one.
 * Comparing the key drops only the entry that actually completed.
 */
async function dropIfCurrent(target: string, key: string) {
	const current = pending.find((p) => p.target === target);
	if (!current || current.key !== key) return;
	await tx('readwrite', (s) => s.delete(target));
	pending = pending.filter((p) => p.target !== target);
}

async function load() {
	if (!browser) return;
	const db = await idb();
	const rows: Queued[] = await new Promise((resolve, reject) => {
		const out: Queued[] = [];
		const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
		req.onsuccess = () => {
			const cur = req.result;
			if (cur) {
				out.push(cur.value as Queued);
				cur.continue();
			} else resolve(out);
		};
		req.onerror = () => reject(req.error);
	});
	pending = rows;
	void flush();
}

if (browser) {
	void load();
	addEventListener('online', () => void flush());
	// iOS never fires a background sync, so foregrounding the app is our cue.
	addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') void flush();
	});
}
