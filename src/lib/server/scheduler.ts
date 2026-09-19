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

let started = false;

export function startScheduler(): void {
	if (started || !pushConfigured()) return;
	started = true;

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
