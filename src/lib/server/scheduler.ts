/**
 * The one recurring job Seek runs itself: the morning digest.
 *
 * Seek is otherwise stateless and reactive, so rather than a cron container this
 * is a plain interval on the long-lived adapter-node process. It ticks a few
 * times an hour and leans on sendDailyDigest's once-a-day guard for correctness,
 * so a missed tick (or a restart) just sends a little later, never twice.
 */
import { getPrefs } from './prefs';
import { pushConfigured, subscriptionCount } from './push';
import { sendDailyDigest, sendAtTimeNotifications } from './digest';
import { jellyfinConfigured } from './jellyfin';
import { syncAnimeTags } from './anime-sync';

let started = false;

export function startScheduler(): void {
	if (started) return;
	// Start if either job has something to do.
	if (!pushConfigured() && !jellyfinConfigured()) return;
	started = true;

	if (jellyfinConfigured()) startAnimeSync();
	if (!pushConfigured()) return;

	/* A tick's work (a cold calendar build plus a push fan-out) can in principle
	   outrun the interval; without this, two overlapping ticks could both pass the
	   once-a-day guard before either records the send and double-fire. */
	let running = false;

	const tick = async () => {
		if (running) return;
		running = true;
		try {
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
 * Reconcile the Floppy `anime` tag to Jellyfin's Anime library — a few minutes
 * after boot (let warmup settle) and every six hours after. Idempotent and
 * diff-only, so a restart or a missed run costs nothing; a transient Jellyfin
 * outage throws and is logged, leaving existing tags untouched.
 */
function startAnimeSync(): void {
	let running = false;
	const sync = async () => {
		if (running) return;
		running = true;
		try {
			const r = await syncAnimeTags();
			if (r.added || r.removed) {
				console.log(`[anime-sync] +${r.added} −${r.removed} (anime in Jellyfin: ${r.animeInJellyfin})`);
			}
		} catch (err) {
			console.warn('[anime-sync] failed; keeping existing tags:', err);
		} finally {
			running = false;
		}
	};
	setInterval(() => void sync(), 6 * 60 * 60 * 1000);
	setTimeout(() => void sync(), 60 * 1000);
}
