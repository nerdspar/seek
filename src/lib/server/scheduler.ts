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
import { syncAnimeTags } from './anime-sync';
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
	// Shared-show mirroring is independent of push; with fewer than
	// two linked people (or nothing shared) each pass is a couple of DB reads.
	startMirroring();
	started = true;
	/* Always scheduled: the anime tags follow Floppy's genres, and push is
	   always available (Seek generates its own keys). */
	startAnimeSync();
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
 * Reconcile everyone's Floppy `anime` tag to what's anime (anime-sync.ts) — a
 * few minutes after boot (let warmup settle) and every six hours after.
 * Idempotent and diff-only, so a restart or a missed run costs nothing; a show
 * Floppy has no genres for yet keeps its tag.
 */
function startAnimeSync(): void {
	let running = false;
	const sync = async () => {
		if (running) return;
		running = true;
		try {
			// Each person's Floppy carries its own anime tags; Floppy's "Anime"
			// genre (and the household's overrides) decide for all of them.
			await forEachUser(async (user) => {
				const r = await syncAnimeTags();
				if (r.added || r.removed) {
					console.log(`[anime-sync] user ${user.id}: +${r.added} −${r.removed} (anime: ${r.anime})`);
				}
			});
		} catch (err) {
			console.warn('[anime-sync] failed; keeping existing tags:', err);
		} finally {
			running = false;
		}
	};
	setInterval(() => void sync(), 6 * 60 * 60 * 1000);
	setTimeout(() => void sync(), 60 * 1000);
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
		await forEachUser(async (user) => {
			const added = await seedTrackedTitles();
			if (added) console.log(`[catalog] user ${user.id}: ${added} new titles`);
		});
		void refresh();
	};
	setTimeout(() => void seed(), 2 * 60 * 1000);
	setInterval(() => void seed(), 6 * 60 * 60 * 1000);
	setInterval(() => void refresh(), 10 * 60 * 1000);
}

/**
 * The copy out of Floppy (own-tracking plan, step 2): once ~10 minutes after
 * boot for anyone not copied in the last 20 hours, then nightly at 4 AM. A full
 * copy is ~11 minutes of Floppy's time per person (it rebuilds the history for
 * every page), so it runs one person at a time and never on demand.
 */
function startFloppyCopy(): void {
	let running = false;
	const copyStale = async () => {
		if (running) return;
		running = true;
		try {
			await forEachUser(async (user) => {
				const last = lastRun(user.id);
				if (last && Date.now() - Date.parse(last.ranAt) < 20 * 60 * 60 * 1000) return;
				const s = await copyFromFloppy();
				console.log(
					`[copy] user ${user.id}: ${s.plays.tv.seek}/${s.plays.tv.floppy} episode plays, ` +
						`${s.plays.movie.seek}/${s.plays.movie.floppy} film plays, +${s.added} -${s.removed}, ` +
						`${s.review} to review, ${s.pendingCatalog} awaiting show info — ${s.matches ? 'matches' : 'not yet'}`
				);
			});
		} finally {
			running = false;
		}
	};
	setTimeout(() => void copyStale(), 10 * 60 * 1000);
	setInterval(() => {
		if (new Date().getHours() === 4) void copyStale();
	}, 30 * 60 * 1000);
}
