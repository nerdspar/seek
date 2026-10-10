/**
 * The one recurring job Seek runs itself: the morning digest.
 *
 * Seek is otherwise stateless and reactive, so rather than a cron container this
 * is a plain interval on the long-lived adapter-node process. It ticks a few
 * times an hour and leans on sendDailyDigest's once-a-day guard for correctness,
 * so a missed tick (or a restart) just sends a little later, never twice.
 */
import { getPrefs } from './prefs';
import { subscriptionCount } from './push';
import { sendDailyDigest, sendAtTimeNotifications } from './digest';
import { listUsers, type User } from './users';
import { runAs, NotLinkedError } from './userctx';
import { startMirroring } from './household/run';
import { refreshDue, seedTrackedTitles } from './catalog/refresh';
import { tmdbConfigured } from './tmdb';
import { copyFromFloppy } from './tracking/importFloppy';
import { lastRun } from './tracking/store';

/* Every job here is per person: it runs once for each account, *as* that
   account, so it reads their prefs, their calendar and their devices. */

/** One person's notification tick. */
async function notifyTick(): Promise<void> {
	const prefs = await getPrefs();
	if (!prefs.notifyDigest && !prefs.notifyAtTime) return;
	// Nothing to send to — skip the calendar fetch entirely.
	if ((await subscriptionCount()) === 0) return;

	// The digest: once the chosen local hour has arrived, once a day.
	if (prefs.notifyDigest && new Date().getHours() >= prefs.digestHour) {
		await sendDailyDigest();
	}
	// At-air: anything that became available since the last tick.
	if (prefs.notifyAtTime) await sendAtTimeNotifications();
}

/** Run a job for every account. One person's failure (no calendar linked,
 *  Floppy hiccup) never stops the others. */
export async function forEachUser(job: (user: User) => Promise<void>): Promise<void> {
	for (const user of listUsers()) {
		try {
			await runAs(user, () => job(user));
		} catch (err) {
			// Not having linked a service is a normal state, not an error.
			if (!(err instanceof NotLinkedError)) console.warn(`[scheduler] job failed for user ${user.id}:`, err);
		}
	}
}

let started = false;

export function startScheduler(): void {
	if (started) return;
	// The new-show inbox: a couple of DB reads per household.
	startMirroring();
	started = true;
	startCatalog();
	startFloppyCopy();

	/* A tick's work (a cold calendar build plus a push fan-out) can in principle
	   outrun the interval; without this, two overlapping ticks could both pass the
	   once-a-day guard before either records the send and double-fire. */
	let running = false;

	const tick = async () => {
		if (running) return;
		running = true;
		try {
			await forEachUser(notifyTick);
		} catch {
			// A bad tick must not kill the interval; the next one tries again.
		} finally {
			running = false;
		}
	};

	// Every five minutes, so an "it's on now" push lands reasonably promptly.
	setInterval(tick, 5 * 60 * 1000);
	void tick();
}

/**
 * Seek's own copy of show and movie info (docs/own-tracking-plan.md, step 1).
 * Every 6 hours, add any title someone tracks; every 10 minutes, refresh what's
 * due (airing shows hourly, the rest daily or weekly — see catalog/map.ts).
 */
function startCatalog(): void {
	if (!tmdbConfigured()) return;
	let running = false;
	const refresh = async () => {
		if (running) return;
		running = true;
		try {
			const r = await refreshDue();
			if (r.refreshed || r.failed) console.log(`[catalog] refreshed ${r.refreshed}, failed ${r.failed}`);
		} finally {
			running = false;
		}
	};
	const seed = async () => {
		const added = await seedTrackedTitles();
		if (added) console.log(`[catalog] ${added} new titles`);
		void refresh();
	};
	setTimeout(() => void seed(), 2 * 60 * 1000);
	setInterval(() => void seed(), 6 * 60 * 60 * 1000);
	setInterval(() => void refresh(), 10 * 60 * 1000);
}

/**
 * Catching up from Floppy (own-tracking plan): while someone still has Floppy
 * linked, add what reached Floppy alone — Jellyfin marks sent to Floppy's
 * webhook before Jellyfin points at Seek. ~10 minutes after boot, then nightly
 * at 4 AM; each reads back only to a day before the last run (usually one page
 * of Floppy's history). Unlinking Floppy in Settings stops it.
 */
const DAY = 24 * 60 * 60 * 1000;
function startFloppyCopy(): void {
	let running = false;
	const catchUp = async () => {
		if (running) return;
		running = true;
		try {
			await forEachUser(async (user) => {
				const last = lastRun(user.id);
				const since = last ? new Date(Date.parse(last.ranAt) - DAY).toISOString() : undefined;
				const s = await copyFromFloppy(since);
				if (s.added) console.log(`[copy] user ${user.id}: caught up ${s.added} from Floppy`);
			});
		} finally {
			running = false;
		}
	};
	setTimeout(() => void catchUp(), 10 * 60 * 1000);
	setInterval(() => {
		if (new Date().getHours() === 4) void catchUp();
	}, 60 * 60 * 1000);
}
