/**
 * The queue's replay, kept free of IndexedDB and Svelte state so it can be
 * tested on its own (queue.svelte.ts does the storing).
 *
 * What a parked write was, in words — for the notice when the server turns it
 * down for good on replay ("Couldn't mark Severance S1E3 watched: …"), and
 * which title it touched, so the screen can drop its optimistic guess. Read
 * from the request itself, so every caller gets it without saying anything.
 */
export type WriteInfo = { url: string; method: string; body: string | null; about?: string };

export function describeWrite(w: WriteInfo): { label: string; source: string | null; mediaId: string | null } {
	let b: Record<string, unknown> = {};
	try {
		b = w.body ? (JSON.parse(w.body) as Record<string, unknown>) : {};
	} catch {
		/* not JSON — describe it generically */
	}
	const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
	const title = w.about || str(b.title) || 'a title';
	const undo = w.method.toUpperCase() === 'DELETE';
	const ep = typeof b.season === 'number' && typeof b.episode === 'number' ? ` S${b.season}E${b.episode}` : '';
	const path = w.url.split('?')[0];
	const label =
		path === '/api/watch'
			? `${undo ? 'unmark' : 'mark'} ${title}${ep} watched`
			: path === '/api/season'
				? `${undo ? 'unmark' : 'mark'} season ${b.season ?? ''} of ${title}`.replace('season  of', 'a season of')
				: path === '/api/library'
					? undo
						? `remove ${title} from your list`
						: `add ${title} to your list`
					: path === '/api/tags'
						? `change who you watch ${title} with`
						: path === '/api/tracking'
							? `update ${title}`
							: 'save a change made offline';
	return { label, source: str(b.source), mediaId: b.mediaId == null ? null : String(b.mediaId) };
}

export type Parked = WriteInfo & { target: string; key: string; at: number };
export type Rejection<T extends Parked = Parked> = { entry: T; reason: string };

/**
 * Send parked writes oldest first. Each one that lands — or that the server
 * turns down for good (a 4xx never succeeds on retry; often it's a stale
 * action against state that already moved on) — is handed to `done` to leave
 * the queue. A 5xx or a network failure stops the run so order is kept for
 * next time. Returns the turned-down ones, with the server's reason.
 */
export async function replay<T extends Parked>(
	entries: T[],
	send: (e: T) => Promise<Response>,
	done: (e: T) => Promise<void>
): Promise<Rejection<T>[]> {
	const rejected: Rejection<T>[] = [];
	for (const entry of [...entries].sort((a, b) => a.at - b.at)) {
		let res: Response;
		try {
			res = await send(entry);
		} catch {
			break; // still offline — keep the rest for next time
		}
		if (res.ok) await done(entry);
		else if (res.status >= 400 && res.status < 500) {
			const msg = ((await res.json().catch(() => null)) as { message?: string } | null)?.message;
			rejected.push({ entry, reason: msg ?? `HTTP ${res.status}` });
			await done(entry);
		} else break; // 5xx: up but unhappy; try again later
	}
	return rejected;
}

/** The one notice for a run's turned-down writes. */
export function rejectionNotice(rejected: Rejection[]): string {
	const first = describeWrite(rejected[0].entry);
	const more = rejected.length > 1 ? ` (and ${rejected.length - 1} more)` : '';
	return `Couldn’t ${first.label}${more}: ${rejected[0].reason}. Showing what Floppy has now.`;
}
