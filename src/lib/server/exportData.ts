/**
 * Everything one person has in Seek, as one JSON document — what the native
 * app imports on first launch (docs/native-app-plan.md, "Migration"). Totals are
 * included so the app can check it received every row.
 */
import { db } from './db';
import { listShared } from './household/shared';
import { animeOverrides } from './anime-sync';
import type { User } from './users';

export type ExportedPlay = {
	id: number;
	mediaType: 'tv' | 'movie';
	tmdbId: number;
	season: number | null;
	episode: number | null;
	watchedAt: string;
	source: string;
};

export type Export = {
	version: 1;
	exportedAt: string;
	person: { id: number; name: string };
	tracked: { mediaType: 'tv' | 'movie'; tmdbId: number; status: number; score: number | null; notes: string; addedAt: string; updatedAt: string }[];
	plays: ExportedPlay[];
	household: {
		shared: { mediaType: 'tv' | 'movie'; tmdbId: number; title: string | null; createdAt: string }[];
		solo: { mediaType: 'tv' | 'movie'; tmdbId: number }[];
		animeOverrides: { tmdbId: number; isAnime: boolean }[];
	};
	totals: { tracked: number; plays: number; shared: number };
};

const tmdbNumber = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);

export function exportFor(me: User, now = new Date()): Export {
	const d = db();
	const tracked = (
		d
			.prepare('SELECT media_type, tmdb_id, status, score, notes, added_at, updated_at FROM tracked WHERE user_id = ? ORDER BY added_at, media_type, tmdb_id')
			.all(me.id) as { media_type: 'tv' | 'movie'; tmdb_id: number; status: number; score: number | null; notes: string; added_at: string; updated_at: string }[]
	).map((r) => ({ mediaType: r.media_type, tmdbId: r.tmdb_id, status: r.status, score: r.score, notes: r.notes, addedAt: r.added_at, updatedAt: r.updated_at }));
	const plays = (
		d
			.prepare('SELECT id, media_type, tmdb_id, season, episode, watched_at, source FROM plays WHERE user_id = ? ORDER BY watched_at, id')
			.all(me.id) as { id: number; media_type: 'tv' | 'movie'; tmdb_id: number; season: number | null; episode: number | null; watched_at: string; source: string }[]
	).map((r) => ({ id: r.id, mediaType: r.media_type, tmdbId: r.tmdb_id, season: r.season, episode: r.episode, watchedAt: r.watched_at, source: r.source }));
	const shared = listShared(me.householdId)
		.filter((s) => s.source === 'tmdb' && tmdbNumber(s.mediaId) !== null)
		.map((s) => ({ mediaType: s.mediaType, tmdbId: tmdbNumber(s.mediaId)!, title: s.title, createdAt: s.createdAt }));
	const solo = (
		d.prepare("SELECT source, media_id FROM show_choices WHERE household_id = ? AND choice = 'solo'").all(me.householdId) as { source: string; media_id: string }[]
	)
		.filter((r) => r.source === 'tmdb' && tmdbNumber(r.media_id) !== null)
		.map((r) => ({ mediaType: 'tv' as const, tmdbId: tmdbNumber(r.media_id)! }));
	const overrides = [...animeOverrides(me.householdId)]
		.filter(([id]) => tmdbNumber(id) !== null)
		.map(([id, isAnime]) => ({ tmdbId: tmdbNumber(id)!, isAnime }));
	return {
		version: 1,
		exportedAt: now.toISOString(),
		person: { id: me.id, name: me.name },
		tracked,
		plays,
		household: { shared, solo, animeOverrides: overrides },
		totals: { tracked: tracked.length, plays: plays.length, shared: shared.length }
	};
}
