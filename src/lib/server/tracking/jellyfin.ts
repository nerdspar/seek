/**
 * Seek's own Jellyfin webhook (own-tracking plan, step 4). A play from Jellyfin
 * lands in Seek for everyone it counts for (a shared show). Anything that can't
 * be matched is kept in a list shown in Settings — never silently dropped.
 */
import { db, nowIso } from '../db';
import { tmdb } from '../tmdb';
import { expire, invalidate } from '../memo';
import { ensureTitle } from '../catalog/store';
import { refreshTitle } from '../catalog/refresh';
import type { User } from '../users';
import { readJellyfin } from './jellyfinPayload';
import { afterUnplay, playedNear, recordPlay, removeNewestPlay, settleCompletion, watchers, type Kind } from './write';

/** One viewing often arrives twice (a finished Stop and a "played" save). */
const SAME_VIEWING_MS = 30 * 60 * 1000;

type Target = { kind: Kind; tmdbId: number; season: number | null; episode: number | null };

type Find = {
	movie_results?: { id: number }[];
	tv_episode_results?: { show_id: number; season_number: number; episode_number: number }[];
};

/** TMDB's standard numbering for an episode or film, from its own ids. */
async function findByOwnId(kind: Kind, imdbId: string | null, tvdbId: number | null): Promise<Target | null> {
	const tries: [string, string][] = [];
	if (imdbId) tries.push([imdbId, 'imdb_id']);
	if (tvdbId) tries.push([String(tvdbId), 'tvdb_id']);
	for (const [id, external_source] of tries) {
		try {
			const r = await tmdb<Find>(`/find/${encodeURIComponent(id)}`, { external_source });
			if (kind === 'movie' && r.movie_results?.[0]) return { kind, tmdbId: r.movie_results[0].id, season: null, episode: null };
			const ep = r.tv_episode_results?.[0];
			if (kind === 'tv' && ep) return { kind, tmdbId: ep.show_id, season: ep.season_number, episode: ep.episode_number };
		} catch {
			/* try the next id */
		}
	}
	return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const sameName = (a: string) => a.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');

type SearchTv = { results?: { id: number; name?: string; original_name?: string }[] };

/**
 * The last resort for an episode: TMDB splits some shows in two or numbers them
 * differently from Jellyfin (Bake Off: Jellyfin's single show has Series 17;
 * TMDB has the BBC years as one show and the Channel 4 years as another, so
 * it's that one's season 10). Same name, same episode number, aired the same
 * day (±1 for time zones) — taken only when exactly one episode fits.
 */
async function findByAirDate(seriesName: string, episode: number, airDate: string, linked: number | null): Promise<Target | null> {
	const key = sameName(seriesName);
	if (!key) return null;
	const ids = new Set<number>(linked ? [linked] : []);
	for (const t of db().prepare("SELECT tmdb_id, title FROM titles WHERE media_type = 'tv'").all() as { tmdb_id: number; title: string }[]) {
		if (sameName(t.title) === key) ids.add(t.tmdb_id);
	}
	// Shows Seek hasn't seen yet: TMDB's own search, exact names only.
	try {
		const found = await tmdb<SearchTv>('/search/tv', { query: seriesName });
		for (const r of (found.results ?? []).slice(0, 5)) {
			if (sameName(r.name ?? '') === key || sameName(r.original_name ?? '') === key) ids.add(r.id);
		}
	} catch {
		/* the catalog's candidates are still worth trying */
	}
	const day = Date.parse(`${airDate}T00:00:00Z`);
	if (!Number.isFinite(day)) return null;
	const within = [new Date(day - DAY_MS), new Date(day + DAY_MS)].map((d) => d.toISOString().slice(0, 10));
	const hits: Target[] = [];
	for (const id of ids) {
		const filled = db().prepare("SELECT 1 FROM titles WHERE media_type = 'tv' AND tmdb_id = ? AND refreshed_at IS NOT NULL").get(id);
		if (!filled) {
			ensureTitle('tv', id);
			await refreshTitle('tv', id, 0).catch(() => {});
		}
		for (const e of db()
			.prepare('SELECT season, episode FROM episodes WHERE tmdb_id = ? AND episode = ? AND season > 0 AND air_date BETWEEN ? AND ?')
			.all(id, episode, within[0], within[1]) as { season: number; episode: number }[]) {
			hits.push({ kind: 'tv', tmdbId: id, season: e.season, episode: e.episode });
		}
	}
	return hits.length === 1 ? hits[0] : null;
}

/** Does Seek's TMDB copy have this episode? Fetches the show's info first if needed. */
async function episodeExists(tmdbId: number, season: number, episode: number): Promise<boolean> {
	const filled = db().prepare("SELECT refreshed_at FROM titles WHERE media_type = 'tv' AND tmdb_id = ?").get(tmdbId) as
		| { refreshed_at: string | null }
		| undefined;
	if (!filled?.refreshed_at) {
		ensureTitle('tv', tmdbId);
		await refreshTitle('tv', tmdbId, 0).catch(() => {});
	}
	return Boolean(db().prepare('SELECT 1 FROM episodes WHERE tmdb_id = ? AND season = ? AND episode = ?').get(tmdbId, season, episode));
}

export type WebhookOutcome = 'recorded' | 'duplicate' | 'removed' | 'unmatched' | 'ignored';

/** Keep what a webhook call did, for Settings and the container log. The last 50 per person. */
function note(userId: number, outcome: WebhookOutcome, event: string, title: string, detail: string): void {
	console.log(`[webhook] user ${userId}: ${event} ${title} → ${outcome}${detail ? ` (${detail})` : ''}`);
	const d = db();
	/* One viewing sends several events (a stop, another on each pause near the
	   end, "played"). A matched play is recorded once; the same miss again within
	   the half hour is the same viewing, so it updates the entry rather than
	   adding one. */
	const last = d.prepare('SELECT id, at, title, outcome FROM webhook_unmatched WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId) as
		| { id: number; at: string; title: string; outcome: string }
		| undefined;
	if (last && outcome !== 'recorded' && last.title === title && last.outcome === outcome && Date.now() - Date.parse(last.at) < SAME_VIEWING_MS) {
		d.prepare('UPDATE webhook_unmatched SET at = ?, event = ?, detail = ? WHERE id = ?').run(nowIso(), event, detail, last.id);
		return;
	}
	d.prepare('INSERT INTO webhook_unmatched (user_id, at, event, title, detail, outcome) VALUES (?, ?, ?, ?, ?, ?)').run(userId, nowIso(), event, title, detail, outcome);
	d.prepare(
		'DELETE FROM webhook_unmatched WHERE user_id = ? AND id NOT IN (SELECT id FROM webhook_unmatched WHERE user_id = ? ORDER BY id DESC LIMIT 50)'
	).run(userId, userId);
}

const where = (t: Target) => (t.kind === 'movie' ? `TMDB film ${t.tmdbId}` : `TMDB ${t.tmdbId} S${t.season}E${t.episode}`);

export type WebhookResult = { ok: true; did: 'ignored' | 'recorded' | 'duplicate' | 'removed' | 'unmatched'; detail?: string };

/** Handle one Jellyfin webhook call, as `user` (inside runAs). */
export async function handleJellyfin(user: User, payload: unknown): Promise<WebhookResult> {
	const ev = readJellyfin(payload);
	if (ev.action === 'ignore') {
		// Progress ticks and play/pause arrive constantly; only the telling ones are kept.
		if (ev.notable) note(user.id, 'ignored', ev.notable.event, ev.notable.title, ev.reason);
		return { ok: true, did: 'ignored', detail: ev.reason };
	}

	// Episode: its own ids first (standard numbering whatever order Jellyfin shows);
	// else the show from the TMDB link with Jellyfin's numbers, only if that episode exists.
	let target: Target | null = ev.kind === 'movie' && ev.tmdbId ? { kind: 'movie', tmdbId: ev.tmdbId, season: null, episode: null } : null;
	target ??= await findByOwnId(ev.kind, ev.imdbId, ev.tvdbId);
	if (!target && ev.kind === 'tv' && ev.tmdbId && ev.season !== null && ev.episode !== null) {
		if (await episodeExists(ev.tmdbId, ev.season, ev.episode)) target = { kind: 'tv', tmdbId: ev.tmdbId, season: ev.season, episode: ev.episode };
	}
	if (!target && ev.kind === 'tv' && ev.seriesName && ev.episode !== null && ev.airDate) {
		target = await findByAirDate(ev.seriesName, ev.episode, ev.airDate, ev.tmdbId);
	}
	if (!target) {
		note(user.id, 'unmatched', ev.event, ev.title, `ids: tmdb ${ev.tmdbId ?? '–'}, imdb ${ev.imdbId ?? '–'}, tvdb ${ev.tvdbId ?? '–'}`);
		return { ok: true, did: 'unmatched' };
	}

	const { kind, tmdbId, season, episode } = target;
	const mediaId = String(tmdbId);
	// Something new to Seek: its info now, so it shows with its episodes at once.
	if (ensureTitle(kind, tmdbId)) await refreshTitle(kind, tmdbId, 0).catch(() => {});

	if (ev.action === 'unplay') {
		removeNewestPlay(user.id, kind, tmdbId, season, episode);
		afterUnplay(user.id, kind, tmdbId, season, episode);
		bust(kind, mediaId, season);
		note(user.id, 'removed', ev.event, ev.title, where(target));
		return { ok: true, did: 'removed' };
	}

	const at = ev.playedAt && Number.isFinite(Date.parse(ev.playedAt)) ? new Date(ev.playedAt).toISOString() : nowIso();
	if (playedNear(user.id, kind, tmdbId, season, episode, at, SAME_VIEWING_MS)) {
		note(user.id, 'duplicate', ev.event, ev.title, `${where(target)}, already recorded`);
		return { ok: true, did: 'duplicate' };
	}
	for (const id of watchers(user, 'tmdb', mediaId, kind)) {
		recordPlay(id, kind, tmdbId, season, episode, at, 'jellyfin');
		if (kind === 'tv') settleCompletion(id, tmdbId);
	}
	bust(kind, mediaId, season);
	note(user.id, 'recorded', ev.event, ev.title, where(target));
	return { ok: true, did: 'recorded' };
}

/** Let every screen see the change. */
function bust(kind: Kind, mediaId: string, season: number | null): void {
	expire('watchlist:');
	expire('library:');
	expire('stats:');
	expire('collection:');
	expire('upcoming');
	invalidate(`tracking:${kind}:tmdb:${mediaId}`);
	if (kind === 'movie') invalidate(`movie:tmdb:${mediaId}`);
	else {
		invalidate(`show:tmdb:${mediaId}`);
		if (season !== null) invalidate(`season:tmdb:${mediaId}:${season}`);
	}
}

/** What the webhook did lately, newest first (Settings → Your accounts). */
export function recentWebhook(userId: number, limit = 15): { at: string; event: string; title: string; detail: string; outcome: WebhookOutcome }[] {
	return db()
		.prepare('SELECT at, event, title, detail, outcome FROM webhook_unmatched WHERE user_id = ? ORDER BY id DESC LIMIT ?')
		.all(userId, limit) as { at: string; event: string; title: string; detail: string; outcome: WebhookOutcome }[];
}
