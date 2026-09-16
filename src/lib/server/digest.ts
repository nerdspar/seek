/**
 * The daily "airing today" digest.
 *
 * Built from the same calendar the Upcoming tab uses, so it needs no new data
 * source — just a filter to today and a send. Deliberately one notification a
 * day, not one per episode: air *times* in Floppy's feed are mostly placeholders
 * (§5.2), so a per-episode "it's on now" would fire at the wrong moment for most
 * shows. A morning list keyed on the reliable part — the date — is the honest
 * version.
 */
import { getUpcoming } from './upcoming';
import { sendToAll, getLastDigest, setLastDigest } from './push';

/** yyyy-mm-dd in the server's local timezone — the digest is a date, not an instant. */
const localDay = (d: Date) => d.toLocaleDateString('en-CA');

export async function buildTodayDigest(): Promise<{
	title: string;
	body: string;
	url: string;
	count: number;
} | null> {
	const items = await getUpcoming();
	const today = localDay(new Date());
	const airing = items.filter((i) => localDay(new Date(i.start)) === today);
	if (!airing.length) return null;

	// The OS already shows "Seek" above this, so the title is the subject line
	// and the body is the message. Kept consistent: subject always names the day,
	// message always lists what's on.
	const titles = [...new Set(airing.map((i) => i.title))];

	let body: string;
	if (titles.length === 1) {
		const only = airing[0];
		const ep =
			only.season != null && only.episode != null
				? ` · S${String(only.season).padStart(2, '0')}E${String(only.episode).padStart(2, '0')}`
				: '';
		body = `${titles[0]}${ep}`;
	} else if (titles.length <= 3) {
		// "A, B and C"
		body = `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
	} else {
		body = `${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more`;
	}

	return { title: 'Airing today', body, url: '/upcoming', count: titles.length };
}

/**
 * Send today's digest, at most once per day. `force` skips the once-a-day guard
 * for the "send a test" button. A day with nothing airing still records the
 * date, so we don't rebuild it every tick.
 */
export async function sendDailyDigest(
	force = false
): Promise<{ sent: number; note: string | null }> {
	const today = localDay(new Date());
	if (!force && (await getLastDigest()) === today) return { sent: 0, note: 'already sent today' };

	const digest = await buildTodayDigest();
	if (!digest) {
		if (!force) await setLastDigest(today);
		return { sent: 0, note: 'nothing airing today' };
	}

	const { sent } = await sendToAll({
		title: digest.title,
		body: digest.body,
		url: digest.url,
		tag: 'seek-daily-digest'
	});
	if (!force) await setLastDigest(today);
	return { sent, note: null };
}
