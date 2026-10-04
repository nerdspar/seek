/**
 * When mirroring runs: on a timer (catches Jellyfin scrobbles and anything
 * logged outside Seek), shortly after a mark in Seek on a shared show, and once
 * as a backfill when a show is first shared. One pass at a time per household —
 * two overlapping passes could both read "not there yet" and post twice.
 */
import { listUsers } from '../users';
import { currentUser, runAs } from '../userctx';
import { setJoint } from '../tags';
import { floppy } from '../floppy';
import { getPrefs } from '../prefs';
import { sendToDevices } from '../push';
import { backfillShow, mirrorMembers, reconcileHousehold } from './mirror';
import { isShared, share, unshare, type SharedKind, type SharedRef } from './shared';
import { decide, noteShared, scanNewShows, settle, type Added, type Deps, type Settled, type ShowRef } from './newShows';

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
			serial(h, () => reconcileHousehold(h))
				.then(
					(sum) => sum.mirrored && console.log(`[mirror] household ${h}: carried ${sum.mirrored} play(s)`),
					(err) => console.warn(`[mirror] household ${h} failed:`, err)
				)
				// New shows added anywhere — Jellyfin, a download, Floppy's site.
				.then(() => (mirroringAvailable(h) ? scanNewShows(h, mirrorMembers(h), newShowDeps) : []))
				.then(
					(fresh) => fresh.length && console.log(`[mirror] household ${h}: ${fresh.length} new show(s) to sort`),
					(err) => console.warn(`[mirror] new-show scan for household ${h} failed:`, err)
				)
		)
	).then(() => {});
}

/**
 * A show was just added in Seek: settle "together or solo?" for it — with the
 * answer when the add form asked, else per the household setting. Null when
 * sharing isn't on (fewer than two people linked). Never throws: the add itself
 * succeeded and must not be reported as failed over this.
 */
export function settleAdded(show: ShowRef, choice?: 'together' | 'solo'): Settled | null {
	try {
		const me = currentUser();
		if (!me || !mirroringAvailable(me.householdId)) return null;
		if (choice) {
			decide(me.householdId, me.id, show, choice, newShowDeps);
			return choice;
		}
		return settle(me.householdId, me.id, show, newShowDeps);
	} catch (err) {
		console.warn('[mirror] settling a new show failed:', err);
		return null;
	}
}

/** The real Floppy and push behind the new-show logic (newShows.ts). */
export const newShowDeps: Deps = {
	recentAdds: (user) =>
		runAs(user, async () => {
			const raw = await floppy<{ results?: unknown[] }>('/api/v1/media/tv/', { query: { sort: 'added', limit: '25' } });
			return (raw.results ?? []).flatMap((r): Added[] => {
				const row = (r ?? {}) as Record<string, unknown>;
				const item = (row.item ?? {}) as Record<string, unknown>;
				const at = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN;
				if (typeof item.source !== 'string' || typeof item.media_id !== 'string' || Number.isNaN(at)) return [];
				return [{ source: item.source, mediaId: item.media_id, title: typeof item.title === 'string' ? item.title : null, addedAt: at }];
			});
		}),
	share: (h, userId, show) => void setShared(h, userId, show, true),
	notify: (user, shows) =>
		runAs(user, async () => {
			if (!(await getPrefs()).notifyNewShows) return;
			const names = shows.map((s) => s.title ?? 'A show');
			await sendToDevices({
				title: shows.length === 1 ? 'New show' : `${shows.length} new shows`,
				body: `${names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`} — watching together or solo?`,
				url: '/#new-shows',
				tag: 'seek-new-shows'
			});
		})
};

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
export function afterMark(source: string, mediaId: string, mediaType: SharedKind = 'tv'): void {
	try {
		const me = currentUser();
		if (me && isShared(me.householdId, source, mediaId, mediaType) && mirroringAvailable(me.householdId)) {
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
	show: SharedRef,
	on: boolean
): boolean {
	const kind = show.mediaType ?? 'tv';
	// The new-show inbox is for shows; a film's answer is just the share.
	if (kind === 'tv') noteShared(householdId, userId, { source: show.source, mediaId: show.mediaId, title: show.title ?? null }, on);
	if (!on) {
		unshare(householdId, show.source, show.mediaId, kind);
		return false;
	}
	if (share(householdId, userId, show)) {
		void serial(householdId, () => backfillShow(householdId, show.source, show.mediaId, undefined, kind))
			// Tag it again now the catch-up has put it in everyone's library.
			.then(async (sum) => {
				console.log(`[mirror] backfilled ${show.source}:${show.mediaId}:`, sum);
				await syncJointTags(householdId, show, true);
			})
			.catch((err) => console.warn(`[mirror] backfill ${show.source}:${show.mediaId} failed:`, err));
	}
	return true;
}

/**
 * Keep everyone's "together" tag in step with the shared list, so each person's
 * Together/Alone filter agrees with what mirrors. Best-effort: a tag is a label,
 * the shared list is what counts.
 */
export async function syncJointTags(
	householdId: number,
	show: SharedRef,
	on: boolean,
	exceptUserId?: number
): Promise<void> {
	for (const m of mirrorMembers(householdId)) {
		if (m.id === exceptUserId) continue;
		await runAs(m, () => setJoint(show.mediaType ?? 'tv', show.source, show.mediaId, on)).catch((err) =>
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
