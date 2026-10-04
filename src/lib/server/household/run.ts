/**
 * When mirroring runs: on a timer (catches Jellyfin scrobbles and anything
 * logged outside Seek), shortly after a mark in Seek on a shared show, and once
 * as a backfill when a show is first shared. One pass at a time per household —
 * two overlapping passes could both read "not there yet" and post twice.
 */
import { listUsers } from '../users';
import { currentUser, runAs } from '../userctx';
import { setJoint } from '../tags';
import { backfillShow, mirrorMembers, reconcileHousehold } from './mirror';
import { isShared, share, unshare } from './shared';

const running = new Map<number, Promise<unknown>>();

/** Run `job` for a household once any pass already running there has finished. */
function serial<T>(householdId: number, job: () => Promise<T>): Promise<T> {
	const prev = running.get(householdId) ?? Promise.resolve();
	const next = prev.catch(() => {}).then(job);
	running.set(householdId, next);
	void next.finally(() => running.get(householdId) === next && running.delete(householdId)).catch(() => {});
	return next;
}

/** Mirroring needs at least two people in the household with Floppy linked. */
export const mirroringAvailable = (householdId: number) => mirrorMembers(householdId).length >= 2;

function households(): number[] {
	return [...new Set(listUsers().map((u) => u.householdId))];
}

export function reconcileAll(): Promise<void> {
	return Promise.all(
		households().map((h) =>
			serial(h, () => reconcileHousehold(h)).then(
				(sum) => sum.mirrored && console.log(`[mirror] household ${h}: carried ${sum.mirrored} play(s)`),
				(err) => console.warn(`[mirror] household ${h} failed:`, err)
			)
		)
	).then(() => {});
}

/* A mark in Seek on a shared show: mirror it within seconds rather than at the
   next tick. Debounced so marking a whole season is one pass, not twenty. */
const soon = new Map<number, ReturnType<typeof setTimeout>>();
export function reconcileSoon(householdId: number, delayMs = 4000): void {
	clearTimeout(soon.get(householdId));
	soon.set(
		householdId,
		setTimeout(() => {
			soon.delete(householdId);
			void serial(householdId, () => reconcileHousehold(householdId)).catch((err) =>
				console.warn(`[mirror] household ${householdId} failed:`, err)
			);
		}, delayMs)
	);
}

/** After a mark in Seek: nudge mirroring if this show is shared. Never throws —
 *  a mark that landed must not be reported as failed over this. */
export function afterMark(source: string, mediaId: string): void {
	try {
		const me = currentUser();
		if (me && isShared(me.householdId, source, mediaId) && mirroringAvailable(me.householdId)) {
			reconcileSoon(me.householdId);
		}
	} catch (err) {
		console.warn('[mirror] nudge failed:', err);
	}
}

/**
 * Share or unshare a show for the household. Newly shared, the backfill runs in
 * the background: each of you gets the other's plays of episodes you haven't
 * seen. Returns whether it is shared now.
 */
export function setShared(
	householdId: number,
	userId: number,
	show: { source: string; mediaId: string; title?: string | null },
	on: boolean
): boolean {
	if (!on) {
		unshare(householdId, show.source, show.mediaId);
		return false;
	}
	if (share(householdId, userId, show)) {
		void serial(householdId, () => backfillShow(householdId, show.source, show.mediaId))
			// Tag it again now the catch-up has put it in everyone's library.
			.then(async (sum) => {
				console.log(`[mirror] backfilled ${show.source}:${show.mediaId}:`, sum);
				await syncJointTags(householdId, show, true);
			})
			.catch((err) => console.warn(`[mirror] backfill ${show.source}:${show.mediaId} failed:`, err));
	}
	return true;
}

/* ── The one-time joint import ───────────────────────────────────────────── */

export type BulkProgress = {
	total: number;
	done: number;
	/** Plays carried across so far. */
	mirrored: number;
	failed: number;
	running: boolean;
	startedAt: string;
};
const bulk = new Map<number, BulkProgress>();

/** How the last bulk share for this household is going (in memory: a restart
 *  forgets it, and running the same link again resumes safely). */
export const bulkProgress = (householdId: number): BulkProgress | null => bulk.get(householdId) ?? null;

/**
 * Share many shows at once — the household's first "these we watch together".
 * All are marked shared straight away; then each is caught up in turn (the
 * same backfill as sharing one) and tagged Together for everyone. Shows already
 * shared are caught up too, so re-running after an interruption picks up where
 * it stopped: the backfill skips episodes the other person already has.
 */
export function shareMany(
	householdId: number,
	userId: number,
	shows: { source: string; mediaId: string; title?: string | null }[]
): BulkProgress {
	const progress: BulkProgress = {
		total: shows.length,
		done: 0,
		mirrored: 0,
		failed: 0,
		running: true,
		startedAt: new Date().toISOString()
	};
	bulk.set(householdId, progress);
	for (const s of shows) share(householdId, userId, s);

	void (async () => {
		for (const s of shows) {
			try {
				const sum = await serial(householdId, () => backfillShow(householdId, s.source, s.mediaId));
				progress.mirrored += sum.mirrored;
				progress.failed += sum.failed;
				await syncJointTags(householdId, s, true);
			} catch (err) {
				progress.failed++;
				console.warn(`[mirror] bulk: ${s.title ?? `${s.source}:${s.mediaId}`} failed:`, err);
			}
			progress.done++;
			if (progress.done % 25 === 0) console.log(`[mirror] bulk ${progress.done}/${progress.total}, ${progress.mirrored} play(s) carried`);
		}
		progress.running = false;
		console.log(`[mirror] bulk done: ${progress.total} shows, ${progress.mirrored} play(s) carried, ${progress.failed} failed`);
	})();
	return progress;
}

/**
 * Keep everyone's "together" tag in step with the shared list, so each person's
 * Together/Alone filter agrees with what mirrors. Best-effort: a tag is a label,
 * the shared list is what counts.
 */
export async function syncJointTags(
	householdId: number,
	show: { source: string; mediaId: string },
	on: boolean,
	exceptUserId?: number
): Promise<void> {
	for (const m of mirrorMembers(householdId)) {
		if (m.id === exceptUserId) continue;
		await runAs(m, () => setJoint('tv', show.source, show.mediaId, on)).catch((err) =>
			console.warn(`[mirror] tag sync for user ${m.id} failed:`, err)
		);
	}
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Every ten minutes: plenty for "we watched it last night, credit us both". */
export function startMirroring(): void {
	if (timer) return;
	timer = setInterval(() => void reconcileAll(), 10 * 60 * 1000);
	void reconcileAll();
}
