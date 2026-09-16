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
import type { UpcomingItem } from '$lib/types';
import {
	sendToAll,
	getLastDigest,
	setLastDigest,
	getLastAtTime,
	setLastAtTime
} from './push';

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

/**
 * The moment an episode becomes available: its real air time, or — for an
 * all-day streaming drop (no clock time in the feed) — local midnight of that
 * date, which is when those services actually put it up.
 */
function airMoment(item: UpcomingItem): number {
	if (item.hasTime) return new Date(item.start).getTime();
	// item.start is midnight UTC of the date; reinterpret that date as local
	// midnight (no trailing Z parses as local time).
	return new Date(`${item.start.slice(0, 10)}T00:00:00`).getTime();
}

/**
 * Push each show as it airs. Fires anything whose air moment fell in the window
 * since the last check, grouped so a whole season landing at once is one push,
 * not ten. The first run just marks "now" — it never backfills a batch of
 * already-aired episodes onto the phone.
 */
export async function sendAtTimeNotifications(): Promise<number> {
	const nowIso = new Date().toISOString();
	const last = await getLastAtTime();
	if (!last) {
		await setLastAtTime(nowIso);
		return 0;
	}

	const since = new Date(last).getTime();
	const now = Date.now();
	const items = await getUpcoming();
	const due = items.filter((i) => {
		const m = airMoment(i);
		return m > since && m <= now;
	});

	// One notification per show — a season drop is a single "N new episodes".
	const byShow = new Map<string, UpcomingItem[]>();
	for (const i of due) {
		const list = byShow.get(i.title) ?? [];
		list.push(i);
		byShow.set(i.title, list);
	}

	let sent = 0;
	for (const [title, eps] of byShow) {
		let body: string;
		if (eps.length === 1) {
			const e = eps[0];
			body =
				e.season != null && e.episode != null
					? `S${String(e.season).padStart(2, '0')}E${String(e.episode).padStart(2, '0')} is out`
					: 'A new episode is out';
		} else {
			body = `${eps.length} new episodes`;
		}
		const res = await sendToAll({ title, body, url: '/upcoming', tag: `seek-airing-${title}` });
		sent += res.sent;
	}

	await setLastAtTime(nowIso);
	return sent;
}
