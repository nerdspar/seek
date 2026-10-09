/**
 * Show, season, episode and film pages from Seek's own data (own-tracking plan,
 * step 5): your plays and status from Seek's tables, everything else from
 * Seek's TMDB copy — fetched on the spot the first time a title is opened.
 */
import { db } from '../db';
import { memo } from '../memo';
import { tmdb } from '../tmdb';
import { ensureTitle } from '../catalog/store';
import { refreshTitle } from '../catalog/refresh';
import { aired } from './nextUp';
import type { EpisodeDetail, EpisodeRow, MovieDetail, SeasonDetail, SeasonSummary, ShowDetail } from '$lib/types';
import type { Tracking } from '$lib/tracking';

type Kind = 'tv' | 'movie';

const json = <T>(v: unknown, fallback: T): T => {
	try {
		return v == null ? fallback : (JSON.parse(String(v)) as T);
	} catch {
		return fallback;
	}
};

/** The title's row, fetching its info first if Seek has never seen it. */
async function titleRow(kind: Kind, id: number): Promise<Record<string, unknown> | null> {
	const get = () => db().prepare('SELECT * FROM titles WHERE media_type = ? AND tmdb_id = ?').get(kind, id) as Record<string, unknown> | undefined;
	let row = get();
	if (!row?.refreshed_at) {
		ensureTitle(kind, id);
		await refreshTitle(kind, id, 0).catch(() => {});
		row = get();
	}
	return row?.refreshed_at ? row : null;
}

/** Your status and rating for a title (UNTRACKED when you don't track it). */
export function seekTracking(userId: number, kind: Kind, id: number): Tracking {
	const r = db().prepare('SELECT status, score FROM tracked WHERE user_id = ? AND media_type = ? AND tmdb_id = ?').get(userId, kind, id) as
		| { status: number; score: number | null }
		| undefined;
	return r ? { tracked: true, status: r.status, score: r.score, floppyPath: null } : { tracked: false, status: null, score: null, floppyPath: null };
}

function playCounts(userId: number, id: number, season?: number): Map<string, number> {
	const rows = db()
		.prepare(
			`SELECT season, episode, COUNT(*) AS n FROM plays WHERE user_id = ? AND media_type = 'tv' AND tmdb_id = ?
			${season === undefined ? '' : 'AND season = ?'} GROUP BY season, episode`
		)
		.all(...(season === undefined ? [userId, id] : [userId, id, season])) as { season: number; episode: number; n: number }[];
	return new Map(rows.map((r) => [`${r.season}:${r.episode}`, r.n]));
}

type EpisodeDbRow = { season: number; episode: number; title: string | null; overview: string | null; still: string | null; air_date: string | null; air_at: string | null; runtime: number | null };

const toEpisode = (e: EpisodeDbRow, plays: number): EpisodeRow => ({
	seasonNumber: e.season,
	episodeNumber: e.episode,
	title: e.title ?? `Episode ${e.episode}`,
	synopsis: e.overview,
	still: e.still,
	runtime: e.runtime,
	airDate: e.air_at ?? (e.air_date ? `${e.air_date}T00:00:00Z` : null),
	plays
});

export async function seekShow(userId: number, id: number, now = Date.now()): Promise<ShowDetail | null> {
	const t = await titleRow('tv', id);
	if (!t) return null;
	const eps = db()
		.prepare('SELECT season, episode, air_date, air_at FROM episodes WHERE tmdb_id = ?')
		.all(id) as { season: number; episode: number; air_date: string | null; air_at: string | null }[];
	const played = playCounts(userId, id);
	const seasonInfo = json<{ number: number; name: string | null; poster: string | null; count: number }[]>(t.seasons_json, []);
	const numbers = [...new Set([...seasonInfo.map((s) => s.number), ...eps.map((e) => e.season)])].sort((a, b) => a - b);

	const seasons: SeasonSummary[] = numbers.map((n) => {
		const info = seasonInfo.find((s) => s.number === n);
		const inSeason = eps.filter((e) => e.season === n);
		const watched = inSeason.filter((e) => played.has(`${n}:${e.episode}`)).length;
		const max = inSeason.length || info?.count || null;
		return {
			seasonNumber: n,
			title: info?.name ?? (n === 0 ? 'Specials' : `Season ${n}`),
			poster: info?.poster ?? null,
			progress: watched || null,
			maxProgress: max,
			airedMax: inSeason.length ? inSeason.filter((e) => aired({ airDate: e.air_date, airAt: e.air_at }, now)).length : max,
			tracked: watched > 0
		};
	});
	const regular = eps.filter((e) => e.season > 0);
	const tracking = seekTracking(userId, 'tv', id);
	return {
		mediaId: String(id),
		source: 'tmdb',
		title: (t.title as string) || 'Untitled',
		sourceUrl: `https://www.themoviedb.org/tv/${id}`,
		poster: (t.poster as string | null) ?? null,
		synopsis: (t.overview as string | null) ?? null,
		genres: json<string[]>(t.genres, []),
		score: (t.vote as number | null) ?? null,
		scoreCount: (t.vote_count as number | null) ?? null,
		maxProgress: regular.length || null,
		progress: regular.filter((e) => played.has(`${e.season}:${e.episode}`)).length,
		tracked: tracking.tracked,
		status: (t.status as string | null) ?? null,
		firstAirDate: (t.release_date as string | null) ?? null,
		lastAirDate: (t.last_air_date as string | null) ?? null,
		studios: json<string[]>(t.companies, []),
		runtime: (t.runtime as number | null) ?? null,
		cast: json(t.cast_json, []),
		seasons
	};
}

export async function seekSeason(userId: number, id: number, season: number): Promise<SeasonDetail | null> {
	const t = await titleRow('tv', id);
	if (!t) return null;
	const rows = db().prepare('SELECT * FROM episodes WHERE tmdb_id = ? AND season = ? ORDER BY episode').all(id, season) as EpisodeDbRow[];
	const played = playCounts(userId, id, season);
	const info = json<{ number: number; name: string | null; poster: string | null }[]>(t.seasons_json, []).find((s) => s.number === season);
	const episodes = rows.map((e) => toEpisode(e, played.get(`${season}:${e.episode}`) ?? 0));
	return {
		mediaId: String(id),
		source: 'tmdb',
		seasonNumber: season,
		title: info?.name ?? (season === 0 ? 'Specials' : `Season ${season}`),
		showTitle: (t.title as string) || null,
		poster: info?.poster ?? ((t.poster as string | null) ?? null),
		maxProgress: episodes.length || null,
		progress: episodes.filter((e) => e.plays > 0).length,
		episodes
	};
}

export async function seekEpisode(userId: number, id: number, season: number, episode: number): Promise<EpisodeDetail | null> {
	const t = await titleRow('tv', id);
	if (!t) return null;
	const e = db().prepare('SELECT * FROM episodes WHERE tmdb_id = ? AND season = ? AND episode = ?').get(id, season, episode) as EpisodeDbRow | undefined;
	if (!e) return null;
	const plays = playCounts(userId, id, season).get(`${season}:${episode}`) ?? 0;
	return { ...toEpisode(e, plays), mediaId: String(id), source: 'tmdb', showTitle: (t.title as string) || null };
}

type CollectionItem = { mediaId: string; source: string; title: string; poster: string | null; year: number | null };

/** A franchise's films, from TMDB (cached a day). */
function collectionItems(collectionId: number): Promise<CollectionItem[]> {
	return memo(`tmdb-collection:${collectionId}`, 24 * 60 * 60 * 1000, async () => {
		const c = await tmdb<{ parts?: Record<string, unknown>[] }>(`/collection/${collectionId}`);
		return (c.parts ?? [])
			.map((p) => ({
				mediaId: String(p.id),
				source: 'tmdb',
				title: (p.title as string) || 'Untitled',
				poster: typeof p.poster_path === 'string' ? `https://image.tmdb.org/t/p/w500${p.poster_path}` : null,
				year: typeof p.release_date === 'string' && p.release_date.length >= 4 ? Number(p.release_date.slice(0, 4)) : null,
				date: (p.release_date as string) || '9999'
			}))
			.sort((a, b) => a.date.localeCompare(b.date))
			.map(({ date: _date, ...rest }) => rest);
	});
}

export async function seekMovie(userId: number, id: number): Promise<MovieDetail | null> {
	const t = await titleRow('movie', id);
	if (!t) return null;
	const plays = (db().prepare("SELECT COUNT(*) AS n FROM plays WHERE user_id = ? AND media_type = 'movie' AND tmdb_id = ?").get(userId, id) as { n: number }).n;
	const tracking = seekTracking(userId, 'movie', id);
	const coll = json<{ id: number; name: string } | null>(t.collection_json, null);
	const items = coll ? await collectionItems(coll.id).catch(() => []) : [];
	return {
		mediaId: String(id),
		source: 'tmdb',
		title: (t.title as string) || 'Untitled',
		sourceUrl: `https://www.themoviedb.org/movie/${id}`,
		poster: (t.poster as string | null) ?? null,
		synopsis: (t.overview as string | null) ?? null,
		genres: json<string[]>(t.genres, []),
		score: (t.vote as number | null) ?? null,
		scoreCount: (t.vote_count as number | null) ?? null,
		maxProgress: 1,
		progress: plays > 0 ? 1 : 0,
		watched: plays > 0,
		tracked: tracking.tracked,
		status: (t.status as string | null) ?? null,
		releaseDate: (t.release_date as string | null) ?? null,
		studios: json<string[]>(t.companies, []),
		runtime: (t.runtime as number | null) ?? null,
		certification: (t.certification as string | null) ?? null,
		cast: json(t.cast_json, []),
		// One film alone in its "collection" isn't worth a rail (as before).
		collection: coll && items.length > 1 ? { name: coll.name, items } : null
	};
}
