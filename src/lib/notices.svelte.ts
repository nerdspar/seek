/**
 * Brief confirmations for actions that would otherwise pass in silence.
 *
 * Marking an episode already speaks, because undo needs somewhere to live.
 * Adding a title or filling a season does not: the control changes state and
 * that is all. On a desktop a subtle change is enough; on the phone this is
 * actually built for it often is not, and there is no fallback — iOS Safari
 * implements no Vibration API, so §4.2's haptic never fires. A line of text is
 * the only confirmation available.
 *
 * Global rather than threaded through props: an add button lives four
 * components deep on Discover, and passing a handler down that chain to say
 * "Added" is more plumbing than the feature is worth.
 *
 * Named .svelte.ts because it holds rune state. In a plain .ts the runes are
 * never compiled and $state throws at import time, taking every page with it.
 */
import { browser } from '$app/environment';

/** A one-tap follow-up offered with the confirmation ("Watching together"). */
export type NoticeAction = { label: string; run: () => void | Promise<void> };
export type Notice = { id: number; message: string; action?: NoticeAction };

let nextId = 1;

/** The current notice, or null. Read by the host in +layout.svelte. */
export const notice = $state<{ current: Notice | null }>({ current: null });

/* Whether to speak at all. Fetched once and cached: the preference is read far
   more often than it changes, and a request per confirmation would be absurd. */
let enabled: boolean | null = null;
let loading: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
	if (enabled !== null || !browser) return;
	loading ??= fetch('/api/prefs')
		.then((r) => (r.ok ? r.json() : null))
		.then((p) => {
			enabled = p?.confirmToasts !== false;
		})
		.catch(() => {
			// Default to speaking. A missed confirmation is worse than a spare one.
			enabled = true;
		});
	await loading;
}

/** Called by Settings so a change takes effect without a reload. */
export function setNoticesEnabled(on: boolean): void {
	enabled = on;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** Show a confirmation, if the user wants them. One carrying an action shows
 *  even with confirmations off — it's a question, not just a confirmation. */
export async function notify(message: string, action?: NoticeAction): Promise<void> {
	await ensureLoaded();
	if (!enabled && !action) return;

	notice.current = { id: nextId++, message, action };
	if (timer) clearTimeout(timer);
	/* Long enough to read, short enough not to sit over the thing you just did.
	   Deliberately shorter than the undo toast, which has to be actionable —
	   unless this one is too. */
	timer = setTimeout(() => (notice.current = null), action ? 6000 : 2600);
}

/** Something you need to know (a change that didn't save): shown even with
 *  confirmations off, and for longer. */
export function alertNotice(message: string): void {
	notice.current = { id: nextId++, message };
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => (notice.current = null), 8000);
}

/** Run a notice's action, then let the notice go. */
export function runNoticeAction(): void {
	const a = notice.current?.action;
	dismissNotice();
	void a?.run();
}

export function dismissNotice(): void {
	if (timer) clearTimeout(timer);
	notice.current = null;
}
