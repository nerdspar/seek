/**
 * Shared, session-lived overlay for a title's Floppy library membership (and its
 * watch status), so a change made on one screen shows on every other without a
 * reload — the same idea `arr.svelte.ts` uses for Sonarr/Radarr membership.
 *
 * It holds only what THIS session has changed or had confirmed. Read it as
 * `overlay ?? the value the page loaded`: a title nobody has touched falls
 * straight through to its loaded value, and an external change (another device,
 * Floppy itself) arrives the normal way — through a fresh load, whose value is the
 * fallback. Two layers per title: `opt` is an in-flight optimistic change, `server`
 * is one the server confirmed; `opt` wins so a pending change is never masked by a
 * slightly-older confirmation. Client-only; a no-op during SSR.
 */
const browser = typeof window !== 'undefined';

type Fields = { tracked: boolean; status: number | null };
type Entry = { server: Partial<Fields>; opt: Partial<Fields> };

const store = $state<Record<string, Entry>>({});
const keyOf = (source: string, id: string) => `${source}:${id}`;
const ensure = (k: string): Entry => (store[k] ??= { server: {}, opt: {} });

/** Optimistically apply a change, before the server confirms it. */
export function setTitle(source: string, id: string, f: Partial<Fields>): void {
	if (!browser) return;
	const e = ensure(keyOf(source, id));
	e.opt = { ...e.opt, ...f };
}

/** Confirm a change from the server: promote it to the `server` layer and drop
 *  the now-settled optimistic fields. */
export function confirmTitle(source: string, id: string, f: Partial<Fields>): void {
	if (!browser) return;
	const e = ensure(keyOf(source, id));
	e.server = { ...e.server, ...f };
	const opt = { ...e.opt };
	for (const field of Object.keys(f) as (keyof Fields)[]) delete opt[field];
	e.opt = opt;
}

/** Roll optimistic fields back after a failed write. */
export function revertTitle(source: string, id: string, fields: (keyof Fields)[]): void {
	if (!browser) return;
	const e = store[keyOf(source, id)];
	if (!e) return;
	const opt = { ...e.opt };
	for (const field of fields) delete opt[field];
	e.opt = opt;
}

/** Forget everything this session thought about a title (a parked change the
 *  server turned down), so it falls back to what the page loads. */
export function forgetTitle(source: string, id: string): void {
	if (!browser) return;
	delete store[keyOf(source, id)];
}

function read<K extends keyof Fields>(source: string, id: string, field: K, fallback: Fields[K]): Fields[K] {
	const e = store[keyOf(source, id)];
	if (e) {
		if (field in e.opt) return e.opt[field] as Fields[K];
		if (field in e.server) return e.server[field] as Fields[K];
	}
	return fallback;
}

/** Whether the title is in the Floppy library — overlay first, else `fallback`. */
export const trackedOf = (source: string, id: string, fallback: boolean): boolean =>
	read(source, id, 'tracked', fallback);

/** The title's watch-status int — overlay first, else `fallback`. */
export const statusOf = (source: string, id: string, fallback: number | null): number | null =>
	read(source, id, 'status', fallback);
