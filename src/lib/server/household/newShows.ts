/**
 * Together or solo for new shows.
 *
 * A show is solo until someone says otherwise, and copying plays is hard to
 * undo, so a new show is never shared by guesswork. What happens to one is the
 * household's setting:
 * - `together`: shared at once (the usual catch-up runs);
 * - `solo`: recorded as solo, nothing copied;
 * - `ask` (the default): it waits in an inbox — a Watchlist banner, and a push —
 *   until one of you decides. Deciding late loses nothing: sharing catches up.
 *
 * New shows arrive two ways. Added in Seek, they're settled on the spot. Added
 * anywhere else — a Jellyfin play, a download — the new-shows scan
 * finds them in each person's newest additions. Either person's decision
 * holds for both. Shows from before this existed count as decided.
 */
import { db, nowIso } from '../db';
import type { User } from '../users';
import { isShared } from './shared';

export type NewShowsMode = 'ask' | 'together' | 'solo';
export type ShowRef = { source: string; mediaId: string; title: string | null };
export type Added = ShowRef & { addedAt: number };
export type Settled = 'together' | 'solo' | 'pending' | 'known';

export type Deps = {
	/** This person's most recently added shows, newest first. */
	recentAdds: (user: User) => Promise<Added[]>;
	/** Share a show (and run its catch-up). */
	share: (householdId: number, userId: number, show: ShowRef) => void;
	/** Tell someone there are shows waiting for an answer. */
	notify: (user: User, shows: ShowRef[]) => Promise<void>;
};

const MODES: NewShowsMode[] = ['ask', 'together', 'solo'];
export const isMode = (v: unknown): v is NewShowsMode => MODES.includes(v as NewShowsMode);

export function newShowsMode(householdId: number): NewShowsMode {
	const r = db().prepare('SELECT new_shows FROM households WHERE id = ?').get(householdId) as { new_shows: string } | undefined;
	return isMode(r?.new_shows) ? r.new_shows : 'ask';
}

export function setNewShowsMode(householdId: number, mode: NewShowsMode): void {
	db().prepare('UPDATE households SET new_shows = ? WHERE id = ?').run(mode, householdId);
}

function since(householdId: number): number | null {
	const r = db().prepare('SELECT new_shows_since FROM households WHERE id = ?').get(householdId) as
		| { new_shows_since: string | null }
		| undefined;
	return r?.new_shows_since ? Date.parse(r.new_shows_since) : null;
}

function choiceOf(householdId: number, show: ShowRef): 'solo' | 'pending' | null {
	const r = db()
		.prepare('SELECT choice FROM show_choices WHERE household_id = ? AND source = ? AND media_id = ?')
		.get(householdId, show.source, show.mediaId) as { choice: 'solo' | 'pending' } | undefined;
	return r?.choice ?? null;
}

function record(householdId: number, userId: number, show: ShowRef, choice: 'solo' | 'pending'): void {
	db()
		.prepare(
			`INSERT INTO show_choices (household_id, source, media_id, title, choice, user_id, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (household_id, source, media_id) DO UPDATE SET choice = excluded.choice, user_id = excluded.user_id`
		)
		.run(householdId, show.source, show.mediaId, show.title, choice, userId, nowIso());
}

/** Shows waiting for "together or solo?", oldest first. */
export function pendingShows(householdId: number): ShowRef[] {
	return (
		db()
			.prepare(`SELECT source, media_id, title FROM show_choices WHERE household_id = ? AND choice = 'pending' ORDER BY created_at`)
			.all(householdId) as { source: string; media_id: string; title: string | null }[]
	).map((r) => ({ source: r.source, mediaId: r.media_id, title: r.title }));
}

/** Fill in titles the inbox doesn't have yet (a show whose details weren't
 *  fetched when it was first seen), and keep them. */
export async function fillTitles(householdId: number, titleOf: (show: ShowRef) => Promise<string | null>): Promise<void> {
	for (const show of pendingShows(householdId).filter((s) => !s.title)) {
		const title = await titleOf(show).catch(() => null);
		if (title) {
			db()
				.prepare('UPDATE show_choices SET title = ? WHERE household_id = ? AND source = ? AND media_id = ?')
				.run(title, householdId, show.source, show.mediaId);
		}
	}
}

/** A show just appeared in someone's library: settle it per the setting.
 *  'known' = already shared or already answered — nothing to do. */
export function settle(householdId: number, userId: number, show: ShowRef, deps: Pick<Deps, 'share'>): Settled {
	if (isShared(householdId, show.source, show.mediaId) || choiceOf(householdId, show)) return 'known';
	const mode = newShowsMode(householdId);
	if (mode === 'together') {
		deps.share(householdId, userId, show);
		return 'together';
	}
	record(householdId, userId, show, mode === 'solo' ? 'solo' : 'pending');
	return mode === 'solo' ? 'solo' : 'pending';
}

/** The show's answer changed elsewhere (the Together chip on its page): it's
 *  out of the inbox either way, and "not together" is a solo answer. */
export function noteShared(householdId: number, userId: number, show: ShowRef, on: boolean): void {
	if (on) {
		db()
			.prepare('DELETE FROM show_choices WHERE household_id = ? AND source = ? AND media_id = ?')
			.run(householdId, show.source, show.mediaId);
	} else {
		record(householdId, userId, show, 'solo');
	}
}

/** One of you answered. Together shares it (and catches up); solo records it. */
export function decide(
	householdId: number,
	userId: number,
	show: ShowRef,
	choice: 'together' | 'solo',
	deps: Pick<Deps, 'share'>
): void {
	if (choice === 'solo') {
		record(householdId, userId, show, 'solo');
		return;
	}
	db()
		.prepare('DELETE FROM show_choices WHERE household_id = ? AND source = ? AND media_id = ?')
		.run(householdId, show.source, show.mediaId);
	deps.share(householdId, userId, show);
}

/**
 * Look through everyone's newest additions for shows nobody has answered for,
 * and settle them. Returns the ones now waiting, after telling everyone. The
 * first run for a household only sets the starting line.
 */
export async function scanNewShows(householdId: number, members: User[], deps: Deps, now = Date.now()): Promise<ShowRef[]> {
	const from = since(householdId);
	if (from === null) {
		db().prepare('UPDATE households SET new_shows_since = ? WHERE id = ?').run(new Date(now).toISOString(), householdId);
		return [];
	}
	const waiting = new Map<string, ShowRef>();
	for (const m of members) {
		const adds = await deps.recentAdds(m).catch(() => [] as Added[]);
		for (const a of adds) {
			if (a.addedAt <= from) continue;
			const show = { source: a.source, mediaId: a.mediaId, title: a.title };
			if (settle(householdId, m.id, show, deps) === 'pending') waiting.set(`${a.source}:${a.mediaId}`, show);
		}
	}
	const fresh = [...waiting.values()];
	if (fresh.length) for (const m of members) await deps.notify(m, fresh).catch(() => {});
	return fresh;
}
