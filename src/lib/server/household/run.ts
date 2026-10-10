/**
 * Sharing and the new-show inbox, run from Seek's own data. Sharing a title
 * catches each of you up once (mirror.ts); after that every mark lands for both
 * as it's made. New shows added outside Seek's add button (a Jellyfin play) are
 * found every ten minutes from Seek's own list.
 */
import { db } from '../db';
import { listUsers } from '../users';
import { currentUser, runAs } from '../userctx';
import { getPrefs } from '../prefs';
import { sendToDevices } from '../push';
import { backfillShow, mirrorMembers } from './mirror';
import { share, unshare, type SharedRef } from './shared';
import { decide, newShowsMode, noteShared, scanNewShows, settle, type Added, type Deps, type Settled, type ShowRef } from './newShows';

/** Sharing needs at least two people in the household. */
export const mirroringAvailable = (householdId: number) => mirrorMembers(householdId).length >= 2;

function households(): number[] {
	return [...new Set(listUsers().map((u) => u.householdId))];
}

/** Look for new shows to sort, in every household. */
export async function scanAll(): Promise<void> {
	for (const h of households()) {
		if (!mirroringAvailable(h)) continue;
		try {
			const fresh = await scanNewShows(h, mirrorMembers(h), newShowDeps);
			if (fresh.length) console.log(`[household] ${h}: ${fresh.length} new show(s) to sort`);
		} catch (err) {
			console.warn(`[household] new-show scan for ${h} failed:`, err);
		}
	}
}

/**
 * A show was just added in Seek: settle "together or solo?" for it — with the
 * answer when the add form asked, else per the household setting. Null when
 * sharing isn't on. Never throws: the add itself succeeded.
 */
export function settleAdded(show: ShowRef, choice?: 'together' | 'solo'): Settled | null {
	try {
		const me = currentUser();
		if (!me || !mirroringAvailable(me.householdId)) return null;
		if (choice) {
			decide(me.householdId, me.id, show, choice, newShowDeps);
			return choice;
		}
		/* Added in Seek: the add toast asks "together or alone?", so this show
		   should not also sit in the Watchlist inbox. On "ask", default it to solo
		   (changeable from the toast or the show page) rather than leaving it
		   pending; "together"/"solo" households settle as set. The inbox stays for
		   shows that appear with no toast — a Jellyfin play, a download. */
		if (newShowsMode(me.householdId) === 'ask') {
			noteShared(me.householdId, me.id, show, false);
			return 'pending';
		}
		return settle(me.householdId, me.id, show, newShowDeps);
	} catch (err) {
		console.warn('[household] settling a new show failed:', err);
		return null;
	}
}

/** Someone's newest shows, from Seek's list. */
export function recentAdds(userId: number, limit = 25): Added[] {
	return (
		db()
			.prepare(
				`SELECT k.tmdb_id, k.added_at, t.title FROM tracked k
				LEFT JOIN titles t ON t.media_type = k.media_type AND t.tmdb_id = k.tmdb_id
				WHERE k.user_id = ? AND k.media_type = 'tv' ORDER BY k.added_at DESC LIMIT ?`
			)
			.all(userId, limit) as { tmdb_id: number; added_at: string; title: string | null }[]
	).map((r) => ({ source: 'tmdb', mediaId: String(r.tmdb_id), title: r.title || null, addedAt: Date.parse(r.added_at) }));
}

export const newShowDeps: Deps = {
	recentAdds: async (user) => recentAdds(user.id),
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

/**
 * Share or unshare a title for the household. Newly shared, each of you is
 * caught up with the other's plays. Returns whether it is shared now.
 */
export function setShared(householdId: number, userId: number, show: SharedRef, on: boolean): boolean {
	const kind = show.mediaType ?? 'tv';
	// The new-show inbox is for shows; a film's answer is just the share.
	if (kind === 'tv') noteShared(householdId, userId, { source: show.source, mediaId: show.mediaId, title: show.title ?? null }, on);
	if (!on) {
		unshare(householdId, show.source, show.mediaId, kind);
		return false;
	}
	if (share(householdId, userId, show)) {
		const sum = backfillShow(householdId, show.source, show.mediaId, kind);
		if (sum.mirrored) console.log(`[household] caught up ${show.source}:${show.mediaId}:`, sum);
	}
	return true;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Every ten minutes, look for new shows to sort. */
export function startMirroring(): void {
	if (timer) return;
	timer = setInterval(() => void scanAll(), 10 * 60 * 1000);
	void scanAll();
}
