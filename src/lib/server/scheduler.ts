/**
 * The one recurring job Seek runs itself: the morning digest.
 *
 * Seek is otherwise stateless and reactive, so rather than a cron container this
 * is a plain interval on the long-lived adapter-node process. It ticks a few
 * times an hour and leans on sendDailyDigest's once-a-day guard for correctness,
 * so a missed tick (or a restart) just sends a little later, never twice.
 */
import { getPrefs } from './prefs';
import { pushConfigured } from './push';
import { sendDailyDigest } from './digest';

let started = false;

export function startScheduler(): void {
	if (started || !pushConfigured()) return;
	started = true;

	const tick = async () => {
		try {
			const prefs = await getPrefs();
			if (!prefs.notifyDigest) return;
			// Only once the chosen hour has arrived in the server's local time.
			if (new Date().getHours() < prefs.digestHour) return;
			await sendDailyDigest();
		} catch {
			// A bad tick must not kill the interval; the next one tries again.
		}
	};

	setInterval(tick, 10 * 60 * 1000);
	void tick();
}
