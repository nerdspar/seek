/**
 * Seek's own data, read in the shapes the screens already use (own-tracking
 * plan, step 5): tracked titles and plays from Seek's tables, show info from
 * Seek's TMDB copy, next-up computed fresh.
 */
import { db } from '../db';
import { serviceNames } from '../serviceNames';
import { animeOverrides } from '../anime-sync';
import { animeByCatalog } from './anime';
import { nextUp, type Ep, type Played } from './nextUp';
import type { MediaType, WatchlistRow } from '$lib/types';
import type { WatchlistPage } from '../watchlist';

/** The status words the screens and prefs use, to `tracked.status` codes. */
const STATUS_CODE: Record<string, number> = { planning: 0, in_progress: 1, paused: 2, completed: 3, dropped: 4 };

type TitleInfo = {
	tmdbId: number;
	title: string;
	poster: string | null;
	genres: string[];
	originCountry: string[];
	originalLanguage: string | null;
	keywords: string[];
	services: string[];
	releaseDate: string | null;
	runtime: number | null;
};

type TrackedRow = { tmdbId: number; status: number; score: number | null; addedAt: string; updatedAt: string };

export type SeekRow = WatchlistRow & {
	status: number;
	score: number | null;
	addedAt: string;
	/** Last play, else last change. */
	activeAt: string;
	anime: boolean;
	shared: boolean;
	releaseDate: string | null;
	totalEpisodes: number;
};

const json = (v: string | null): string[] => {
	try {
		const x = JSON.parse(v ?? '[]');
		return Array.isArray(x) ? x : [];
	} catch {
		return [];
	}
};

function titles(kind: 'tv' | 'movie', ids: number[]): Map<number, TitleInfo> {
	const out = new Map<number, TitleInfo>();
	if (!ids.length) return out;
	const rows = db()
		.prepare(
			`SELECT tmdb_id, title, poster, genres, origin_country, original_language, keywords, services, release_date, runtime
			FROM titles WHERE media_type = ? AND tmdb_id IN (${ids.map(() => '?').join(',')})`
		)
		.all(kind, ...ids) as Record<string, unknown>[];
	for (const r of rows) {
		out.set(r.tmdb_id as number, {
			tmdbId: r.tmdb_id as number,
			title: (r.title as string) || 'Untitled',
			poster: (r.poster as string | null) ?? null,
			genres: json(r.genres as string),
			originCountry: json(r.origin_country as string),
			originalLanguage: (r.original_language as string | null) ?? null,
			keywords: json(r.keywords as string),
			services: json(r.services as string),
			releaseDate: (r.release_date as string | null) ?? null,
			runtime: (r.runtime as number | null) ?? null
		});
	}
	return out;
}

/** Every row this person tracks of one kind, with next-up and progress. */
export function seekRows(userId: number, householdId: number, kind: 'tv' | 'movie', now = Date.now()): SeekRow[] {
	const d = db();
	const tracked = (
		d.prepare('SELECT tmdb_id, status, score, added_at, updated_at FROM tracked WHERE user_id = ? AND media_type = ?').all(userId, kind) as {
			tmdb_id: number;
			status: number;
			score: number | null;
			added_at: string;
			updated_at: string;
		}[]
	).map((r): TrackedRow => ({ tmdbId: r.tmdb_id, status: r.status, score: r.score, addedAt: r.added_at, updatedAt: r.updated_at }));
	const info = titles(kind, tracked.map((t) => t.tmdbId));

	const plays = new Map<number, Played[]>();
	for (const p of d
		.prepare('SELECT tmdb_id, season, episode, watched_at FROM plays WHERE user_id = ? AND media_type = ?')
		.all(userId, kind) as { tmdb_id: number; season: number | null; episode: number | null; watched_at: string }[]) {
		const list = plays.get(p.tmdb_id) ?? [];
		list.push({ season: p.season ?? 0, episode: p.episode ?? 0, watchedAt: p.watched_at });
		plays.set(p.tmdb_id, list);
	}

	const episodes = new Map<number, (Ep & { title: string | null })[]>();
	if (kind === 'tv' && tracked.length) {
		for (const e of d
			.prepare(
				`SELECT tmdb_id, season, episode, title, air_date, air_at FROM episodes
				WHERE season > 0 AND tmdb_id IN (SELECT tmdb_id FROM tracked WHERE user_id = ? AND media_type = 'tv')`
			)
			.all(userId) as { tmdb_id: number; season: number; episode: number; title: string | null; air_date: string | null; air_at: string | null }[]) {
			const list = episodes.get(e.tmdb_id) ?? [];
			list.push({ season: e.season, episode: e.episode, title: e.title, airDate: e.air_date, airAt: e.air_at });
			episodes.set(e.tmdb_id, list);
		}
	}

	const shared = new Set(
		(d.prepare('SELECT media_id FROM shared_shows WHERE household_id = ? AND media_type = ? AND source = ?').all(householdId, kind, 'tmdb') as {
			media_id: string;
		}[]).map((r) => Number(r.media_id))
	);
	const overrides = kind === 'tv' ? animeOverrides(householdId) : new Map<string, boolean>();

	return tracked.map((t) => {
		const i = info.get(t.tmdbId);
		const ps = plays.get(t.tmdbId) ?? [];
		const lastPlay = ps.reduce((m, p) => (p.watchedAt > m ? p.watchedAt : m), '');
		const base = {
			mediaId: String(t.tmdbId),
			source: 'tmdb',
			mediaType: kind as MediaType,
			title: i?.title ?? 'Untitled',
			poster: i?.poster ?? null,
			services: serviceNames(i?.services ?? []),
			status: t.status,
			score: t.score,
			addedAt: t.addedAt,
			activeAt: lastPlay > t.updatedAt ? lastPlay : t.updatedAt,
			shared: shared.has(t.tmdbId),
			releaseDate: i?.releaseDate ?? null
		};
		if (kind === 'movie') {
			const watched = ps.length > 0 ? 1 : 0;
			return { ...base, anime: false, next: null, progress: watched, maxProgress: 1, left: 1 - watched, totalEpisodes: 1 };
		}
		const eps = episodes.get(t.tmdbId) ?? [];
		const watched = new Set(ps.filter((p) => p.season > 0).map((p) => `${p.season}:${p.episode}`));
		const progress = eps.filter((e) => watched.has(`${e.season}:${e.episode}`)).length;
		const n = nextUp(eps, ps, now);
		const nextEp = n && n !== 'caught-up' ? eps.find((e) => e.season === n.season && e.episode === n.episode) : undefined;
		const override = overrides.get(String(t.tmdbId));
		return {
			...base,
			anime: override ?? (i ? animeByCatalog(i) : false),
			next: nextEp
				? { season: nextEp.season, episode: nextEp.episode, title: nextEp.title, airDate: nextEp.airAt ?? (nextEp.airDate ? `${nextEp.airDate}T00:00:00Z` : null) }
				: null,
			progress,
			maxProgress: eps.length || null,
			left: eps.length ? Math.max(0, eps.length - progress) : null,
			totalEpisodes: eps.length
		};
	});
}

export type SeekListOptions = {
	statuses?: string[];
	sort?: string;
	direction?: 'asc' | 'desc';
	company?: 'all' | 'joint' | 'solo';
	tag?: string;
	tagMode?: 'not';
	services?: string[];
	/** The in-progress backlog drops shows with nothing aired left to watch. */
	dropCaughtUp?: boolean;
};

const cmp = (a: string | number | null, b: string | number | null) => {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return a < b ? -1 : 1;
};

/** The watchlist / library list, from Seek's data. */
export function seekList(userId: number, householdId: number, mediaType: MediaType, o: SeekListOptions = {}, now = Date.now()): WatchlistPage {
	const kind = mediaType === 'movie' ? 'movie' : 'tv';
	const statuses = o.statuses ?? ['in_progress'];
	let rows = seekRows(userId, householdId, kind, now);

	if (!statuses.includes('all')) {
		const codes = new Set(statuses.map((s) => STATUS_CODE[s]).filter((c) => c !== undefined));
		rows = rows.filter((r) => codes.has(r.status));
	}
	if (o.tag === 'anime') rows = rows.filter((r) => (o.tagMode === 'not' ? !r.anime : r.anime));
	else if (o.tag === 'joint') rows = rows.filter((r) => (o.tagMode === 'not' ? !r.shared : r.shared));
	else if (o.company === 'joint') rows = rows.filter((r) => r.shared);
	else if (o.company === 'solo') rows = rows.filter((r) => !r.shared);
	if (o.services?.length) {
		const wanted = new Set(o.services);
		rows = rows.filter((r) => r.services.some((s) => wanted.has(s)));
	}
	const onlyInProgress = statuses.length === 1 && statuses[0] === 'in_progress';
	if (o.dropCaughtUp ?? onlyInProgress) rows = rows.filter((r) => r.mediaType === 'movie' || r.next !== null);

	const dir = o.direction === 'asc' ? 1 : -1;
	const key: (r: SeekRow) => string | number | null = (() => {
		switch (o.sort ?? 'updated') {
			case 'title':
				return (r: SeekRow) => r.title.toLowerCase().replace(/^(the|a|an)\s+/, '');
			case 'added':
				return (r: SeekRow) => r.addedAt;
			case 'release_date':
				return (r: SeekRow) => r.releaseDate;
			case 'score':
				return (r: SeekRow) => r.score;
			case 'next_episode_air_date':
				return (r: SeekRow) => r.next?.airDate ?? null;
			case 'runtime':
				return (r: SeekRow) => r.totalEpisodes;
			case 'time_left':
				return (r: SeekRow) => r.left;
			default:
				return (r: SeekRow) => r.activeAt;
		}
	})();
	// Missing values go last whichever way the sort runs.
	rows.sort((a, b) => {
		const ka = key(a);
		const kb = key(b);
		if (ka === null || kb === null) return cmp(ka, kb);
		return cmp(ka, kb) * dir || a.title.localeCompare(b.title);
	});
	return { rows, total: rows.length, hasMore: false };
}
