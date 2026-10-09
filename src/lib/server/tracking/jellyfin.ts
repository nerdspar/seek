/**
 * Seek's own Jellyfin webhook (own-tracking plan, step 4). A play from Jellyfin
 * lands in Seek first, for everyone it counts for, then is passed on to Floppy
 * so Floppy stays complete until the switch. Anything that can't be matched is
 * kept in a list shown in Settings — never silently dropped.
 */
import { db, nowIso } from '../db';
import { tmdb } from '../tmdb';
import { floppy } from '../floppy';
import { markEpisodeWatched, markMovieWatched, watchMoviePath } from '../api';
import { expire, invalidate } from '../memo';
import { ensureTitle } from '../catalog/store';
import { refreshTitle } from '../catalog/refresh';
import type { User } from '../users';
import { readJellyfin } from './jellyfinPayload';
import { playedNear, recordPlay, removeNewestPlay, watchers, type Kind } from './write';

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

function unmatched(userId: number, event: string, title: string, detail: string): void {
	db()
		.prepare('INSERT INTO webhook_unmatched (user_id, at, event, title, detail) VALUES (?, ?, ?, ?, ?)')
		.run(userId, nowIso(), event, title, detail);
}

export type WebhookResult = { ok: true; did: 'ignored' | 'recorded' | 'duplicate' | 'removed' | 'unmatched'; detail?: string };

/** Handle one Jellyfin webhook call, as `user` (inside runAs). */
export async function handleJellyfin(user: User, payload: unknown): Promise<WebhookResult> {
	const ev = readJellyfin(payload);
	if (ev.action === 'ignore') return { ok: true, did: 'ignored', detail: ev.reason };

	// Episode: its own ids first (standard numbering whatever order Jellyfin shows);
	// else the show from the TMDB link with Jellyfin's numbers, only if that episode exists.
	let target: Target | null = ev.kind === 'movie' && ev.tmdbId ? { kind: 'movie', tmdbId: ev.tmdbId, season: null, episode: null } : null;
	target ??= await findByOwnId(ev.kind, ev.imdbId, ev.tvdbId);
	if (!target && ev.kind === 'tv' && ev.tmdbId && ev.season !== null && ev.episode !== null) {
		if (await episodeExists(ev.tmdbId, ev.season, ev.episode)) target = { kind: 'tv', tmdbId: ev.tmdbId, season: ev.season, episode: ev.episode };
	}
	if (!target) {
		unmatched(user.id, ev.event, ev.title, `ids: tmdb ${ev.tmdbId ?? '–'}, imdb ${ev.imdbId ?? '–'}, tvdb ${ev.tvdbId ?? '–'}`);
		return { ok: true, did: 'unmatched' };
	}

	const { kind, tmdbId, season, episode } = target;
	const mediaId = String(tmdbId);
	ensureTitle(kind, tmdbId);

	if (ev.action === 'unplay') {
		removeNewestPlay(user.id, kind, tmdbId, season, episode);
		await floppy(kind === 'movie' ? watchMoviePath('tmdb', mediaId) : `/api/v1/media/tv/tmdb/${mediaId}/${season}/episodes/${episode}/watch/`, {
			method: 'DELETE'
		}).catch((err) => console.warn('[webhook] passing an unplay on to Floppy failed:', err));
		bust(kind, mediaId, season);
		return { ok: true, did: 'removed' };
	}

	const at = ev.playedAt && Number.isFinite(Date.parse(ev.playedAt)) ? new Date(ev.playedAt).toISOString() : nowIso();
	if (playedNear(user.id, kind, tmdbId, season, episode, at, SAME_VIEWING_MS)) return { ok: true, did: 'duplicate' };
	for (const id of watchers(user, 'tmdb', mediaId, kind)) recordPlay(id, kind, tmdbId, season, episode, at, 'jellyfin');

	// Floppy stays complete until the switch (its own household mirror carries shared plays).
	try {
		if (kind === 'movie') await markMovieWatched('tmdb', mediaId);
		else await markEpisodeWatched('tmdb', mediaId, season as number, episode as number);
	} catch (err) {
		console.warn('[webhook] passing a play on to Floppy failed (kept in Seek):', err);
	}
	bust(kind, mediaId, season);
	return { ok: true, did: 'recorded' };
}

/** The screens still read Floppy: let them see the change. */
function bust(kind: Kind, mediaId: string, season: number | null): void {
	expire('watchlist:');
	expire('library:');
	expire('stats:');
	invalidate(`tracking:${kind}:tmdb:${mediaId}`);
	if (kind === 'movie') invalidate(`movie:tmdb:${mediaId}`);
	else {
		invalidate(`show:tmdb:${mediaId}`);
		if (season !== null) invalidate(`season:tmdb:${mediaId}:${season}`);
	}
}

/** What the webhook couldn't match lately (Settings). */
export function recentUnmatched(userId: number, limit = 10): { at: string; event: string; title: string; detail: string }[] {
	return db()
		.prepare('SELECT at, event, title, detail FROM webhook_unmatched WHERE user_id = ? ORDER BY at DESC LIMIT ?')
		.all(userId, limit) as { at: string; event: string; title: string; detail: string }[];
}
