/**
 * Profile's Watching numbers, the diary, collection counts and Upcoming, from
 * Seek's own plays and TMDB copy (own-tracking plan, step 5). Dates are the
 * server's local time (the container's TZ).
 */
import { db } from '../db';
import { rangeDates, type DiaryDay, type DiaryEntry, type RangeKey, type Stats, type CollectionCounts } from '../stats';
import { animeOverrides } from '../anime-sync';
import { animeByCatalog } from './anime';
import type { UpcomingItem } from '$lib/types';

const json = (v: unknown): string[] => {
	try {
		const x = JSON.parse(String(v ?? '[]'));
		return Array.isArray(x) ? x : [];
	} catch {
		return [];
	}
};
const localDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA');
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "572h 54min", thousands grouped ("5,357h 28min"), as Profile showed them. */
export function duration(minutes: number): string {
	const m = Math.round(minutes);
	const h = Math.floor(m / 60);
	const rest = m % 60;
	if (!h) return `${rest}min`;
	return `${h.toLocaleString('en-US')}h${rest ? ` ${rest}min` : ''}`;
}

type Play = {
	kind: 'tv' | 'movie';
	tmdbId: number;
	season: number | null;
	episode: number | null;
	at: string;
	day: string;
	minutes: number;
};

/** This person's plays with runtimes (episode runtime, else the show's). */
function plays(userId: number): Play[] {
	return (
		db()
			.prepare(
				`SELECT p.media_type AS kind, p.tmdb_id, p.season, p.episode, p.watched_at,
					COALESCE(e.runtime, t.runtime, 0) AS minutes
				FROM plays p
				LEFT JOIN episodes e ON e.tmdb_id = p.tmdb_id AND e.season = p.season AND e.episode = p.episode AND p.media_type = 'tv'
				LEFT JOIN titles t ON t.media_type = p.media_type AND t.tmdb_id = p.tmdb_id
				WHERE p.user_id = ?`
			)
			.all(userId) as { kind: 'tv' | 'movie'; tmdb_id: number; season: number | null; episode: number | null; watched_at: string; minutes: number }[]
	).map((r) => ({ kind: r.kind, tmdbId: r.tmdb_id, season: r.season, episode: r.episode, at: r.watched_at, day: localDay(r.watched_at), minutes: r.minutes }));
}

type Title = { title: string; poster: string | null; genres: string[]; networks: string[]; anime: boolean };

function titleInfo(householdId: number): Map<string, Title> {
	const overrides = animeOverrides(householdId);
	const out = new Map<string, Title>();
	for (const r of db()
		.prepare('SELECT media_type, tmdb_id, title, poster, genres, networks, origin_country, original_language, keywords FROM titles')
		.all() as Record<string, unknown>[]) {
		const genres = json(r.genres);
		const byRule = animeByCatalog({ genres, originCountry: json(r.origin_country), originalLanguage: (r.original_language as string | null) ?? null, keywords: json(r.keywords) });
		out.set(`${r.media_type}:${r.tmdb_id}`, {
			title: (r.title as string) || 'Untitled',
			poster: (r.poster as string | null) ?? null,
			genres,
			networks: json(r.networks),
			anime: r.media_type === 'tv' && (overrides.get(String(r.tmdb_id)) ?? byRule)
		});
	}
	return out;
}

/** Days in a row with a play, ending today or yesterday; and the longest run. */
export function streaks(days: Set<string>, today: string): { current: number; longest: number } {
	const prev = (d: string) => {
		const x = new Date(`${d}T12:00:00Z`);
		x.setUTCDate(x.getUTCDate() - 1);
		return x.toISOString().slice(0, 10);
	};
	let current = 0;
	for (let d = days.has(today) ? today : prev(today); days.has(d); d = prev(d)) current++;
	let longest = 0;
	for (const d of days) {
		if (days.has(prev(d))) continue;
		let n = 0;
		for (let x = d; days.has(x); ) {
			n++;
			const next = new Date(`${x}T12:00:00Z`);
			next.setUTCDate(next.getUTCDate() + 1);
			x = next.toISOString().slice(0, 10);
		}
		longest = Math.max(longest, n);
	}
	return { current, longest };
}

const top = <T>(m: Map<string, T & { minutes: number }>, n: number) => [...m.entries()].sort((a, b) => b[1].minutes - a[1].minutes).slice(0, n);

export function seekStats(userId: number, householdId: number, key: RangeKey, now = new Date()): Stats {
	const { start, end, label } = rangeDates(key, now);
	const info = titleInfo(householdId);
	const all = plays(userId);
	const inRange = all.filter((p) => (!start || p.day >= start) && (!end || p.day <= end));

	const minutes = inRange.reduce((n, p) => n + p.minutes, 0);
	const weekdayMin = Array(7).fill(0);
	for (const p of inRange) weekdayMin[new Date(p.at).getDay()] += p.minutes;
	const busiest = weekdayMin.indexOf(Math.max(...weekdayMin));

	// The chart: the range's year, month by month (or the last 12 months).
	const year = start ? Number(start.slice(0, 4)) : now.getFullYear();
	const monthly = { labels: MONTHS, all: Array(12).fill(0), tv: Array(12).fill(0), movie: Array(12).fill(0) };
	for (const p of all) {
		if (Number(p.day.slice(0, 4)) !== year) continue;
		const m = Number(p.day.slice(5, 7)) - 1;
		monthly.all[m] += p.minutes / 60;
		monthly[p.kind][m] += p.minutes / 60;
	}
	for (const s of [monthly.all, monthly.tv, monthly.movie]) s.forEach((v, i) => (s[i] = Math.round(v)));

	const distinct = (pred: (p: Play) => boolean) => new Set(inRange.filter(pred).map((p) => p.tmdbId)).size;
	const isAnime = (p: Play) => p.kind === 'tv' && Boolean(info.get(`tv:${p.tmdbId}`)?.anime);
	const counts = {
		tv: distinct((p) => p.kind === 'tv' && !isAnime(p)),
		anime: distinct(isAnime),
		movie: distinct((p) => p.kind === 'movie')
	};

	const genres = new Map<string, { minutes: number }>();
	const shows = new Map<string, { minutes: number; plays: number; tmdbId: number }>();
	const networks = new Map<string, { minutes: number; shows: Set<number> }>();
	for (const p of inRange) {
		if (p.kind !== 'tv') continue;
		const t = info.get(`tv:${p.tmdbId}`);
		for (const g of t?.genres ?? []) genres.set(g, { minutes: (genres.get(g)?.minutes ?? 0) + p.minutes });
		const s = shows.get(String(p.tmdbId)) ?? { minutes: 0, plays: 0, tmdbId: p.tmdbId };
		s.minutes += p.minutes;
		s.plays++;
		shows.set(String(p.tmdbId), s);
		for (const n of t?.networks ?? []) {
			const x = networks.get(n) ?? { minutes: 0, shows: new Set<number>() };
			x.minutes += p.minutes;
			x.shows.add(p.tmdbId);
			networks.set(n, x);
		}
	}

	const completed = (
		db()
			.prepare('SELECT COUNT(*) AS n FROM tracked WHERE user_id = ? AND status = 3 AND (? IS NULL OR substr(updated_at, 1, 10) >= ?) AND (? IS NULL OR substr(updated_at, 1, 10) <= ?)')
			.get(userId, start ?? null, start ?? null, end ?? null, end ?? null) as { n: number }
	).n;
	const s = streaks(new Set(inRange.map((p) => p.day)), localDay(now.toISOString()));
	const rated = db()
		.prepare('SELECT media_type, tmdb_id, score FROM tracked WHERE user_id = ? AND score IS NOT NULL ORDER BY score DESC, updated_at DESC LIMIT 8')
		.all(userId) as { media_type: 'tv' | 'movie'; tmdb_id: number; score: number }[];

	return {
		rangeLabel: label,
		hours: Math.round(minutes / 60),
		plays: inRange.length,
		minutes: Math.round(minutes),
		counts: { ...counts, total: counts.tv + counts.anime + counts.movie },
		completed,
		currentStreak: s.current,
		longestStreak: s.longest,
		mostActiveDay: minutes ? WEEKDAY_NAMES[busiest] : null,
		mostActiveDayPct: minutes ? Math.round((weekdayMin[busiest] / minutes) * 100) : null,
		weekday: WEEKDAYS.map((l, i) => ({ label: l, hours: Math.round((weekdayMin[i] / 60) * 100) / 100 })),
		monthly,
		topGenres: top(genres, 6).map(([name, g]) => ({ name, duration: duration(g.minutes) })),
		topTitles: top(shows, 5).map(([id, x]) => ({
			title: info.get(`tv:${id}`)?.title ?? 'Untitled',
			poster: info.get(`tv:${id}`)?.poster ?? null,
			mediaId: id,
			source: 'tmdb',
			duration: duration(x.minutes),
			plays: x.plays
		})),
		topRated: rated.map((r) => ({
			title: info.get(`${r.media_type}:${r.tmdb_id}`)?.title ?? 'Untitled',
			poster: info.get(`${r.media_type}:${r.tmdb_id}`)?.poster ?? null,
			mediaId: String(r.tmdb_id),
			source: 'tmdb',
			mediaType: r.media_type,
			score: r.score
		})),
		topStudios: [...networks.entries()]
			.sort((a, b) => b[1].minutes - a[1].minutes)
			.slice(0, 5)
			.map(([name, x]) => ({ name, watched: duration(x.minutes), shows: x.shows.size }))
	};
}

/** How many shows, anime and films this person tracks (Profile → Collection). */
export function seekCollectionCounts(userId: number, householdId: number): CollectionCounts {
	const info = titleInfo(householdId);
	const rows = db().prepare('SELECT media_type, tmdb_id FROM tracked WHERE user_id = ?').all(userId) as { media_type: 'tv' | 'movie'; tmdb_id: number }[];
	let tv = 0;
	let anime = 0;
	let movie = 0;
	for (const r of rows) {
		if (r.media_type === 'movie') movie++;
		else if (info.get(`tv:${r.tmdb_id}`)?.anime) anime++;
		else tv++;
	}
	return { tv, movie, anime };
}

/** The diary: plays grouped by day, newest first, a page of days at a time. */
export function seekDiary(userId: number, householdId: number, offset = 0, limit = 20): { days: DiaryDay[]; hasMore: boolean; total: number } {
	const info = titleInfo(householdId);
	const titles = new Map(
		(db().prepare('SELECT tmdb_id, season, episode, title FROM episodes WHERE tmdb_id IN (SELECT DISTINCT tmdb_id FROM plays WHERE user_id = ?)').all(userId) as {
			tmdb_id: number;
			season: number;
			episode: number;
			title: string | null;
		}[]).map((e) => [`${e.tmdb_id}:${e.season}:${e.episode}`, e.title])
	);
	const byDay = new Map<string, Play[]>();
	for (const p of plays(userId).sort((a, b) => b.at.localeCompare(a.at))) {
		const list = byDay.get(p.day) ?? [];
		list.push(p);
		byDay.set(p.day, list);
	}
	const dayKeys = [...byDay.keys()].sort((a, b) => b.localeCompare(a));
	const days = dayKeys.slice(offset, offset + limit).map((day): DiaryDay => {
		const list = byDay.get(day)!;
		const total = list.reduce((n, p) => n + p.minutes, 0);
		return {
			date: day,
			label: new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
			total: total ? duration(total) : null,
			entries: list.map((p): DiaryEntry => {
				const t = info.get(`${p.kind}:${p.tmdbId}`);
				return {
					showTitle: t?.title ?? 'Untitled',
					episodeTitle: p.kind === 'tv' ? (titles.get(`${p.tmdbId}:${p.season}:${p.episode}`) ?? null) : null,
					poster: t?.poster ?? null,
					mediaId: String(p.tmdbId),
					source: 'tmdb',
					mediaType: p.kind,
					code: p.kind === 'tv' ? `S${String(p.season).padStart(2, '0')}E${String(p.episode).padStart(2, '0')}` : null,
					playedAt: p.at,
					runtime: p.minutes ? duration(p.minutes) : null
				};
			})
		};
	});
	return { days, hasMore: offset + limit < dayKeys.length, total: dayKeys.length };
}

/** The diary offset whose page starts at `date`: the day itself if you watched
 *  anything then, else the nearest earlier day you did. */
export function seekDiaryOffset(userId: number, date: string): number {
	return new Set(plays(userId).map((p) => p.day).filter((d) => d > date)).size;
}

/**
 * Upcoming: episodes of the shows you track (not dropped) and the films you
 * track, from 30 days back to a year ahead. A real air time where TVmaze had one;
 * otherwise the date, marked as having no time.
 */
export function seekUpcoming(userId: number, now = Date.now()): UpcomingItem[] {
	const from = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const to = new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const eps = db()
		.prepare(
			`SELECT t.tmdb_id, t.title, t.poster, e.season, e.episode, e.air_date, e.air_at
			FROM tracked k JOIN titles t ON t.media_type = 'tv' AND t.tmdb_id = k.tmdb_id
			JOIN episodes e ON e.tmdb_id = k.tmdb_id AND e.season > 0
			WHERE k.user_id = ? AND k.media_type = 'tv' AND k.status != 4 AND e.air_date BETWEEN ? AND ?`
		)
		.all(userId, from, to) as { tmdb_id: number; title: string; poster: string | null; season: number; episode: number; air_date: string; air_at: string | null }[];
	const films = db()
		.prepare(
			`SELECT t.tmdb_id, t.title, t.poster, t.release_date FROM tracked k JOIN titles t ON t.media_type = 'movie' AND t.tmdb_id = k.tmdb_id
			WHERE k.user_id = ? AND k.media_type = 'movie' AND k.status != 4 AND t.release_date BETWEEN ? AND ?`
		)
		.all(userId, from, to) as { tmdb_id: number; title: string; poster: string | null; release_date: string }[];
	const items: UpcomingItem[] = [
		...eps.map((e) => ({
			title: e.title,
			season: e.season,
			episode: e.episode,
			// A date with no time is a date, not an instant: midday UTC keeps it on the
			// same calendar day everywhere (midnight UTC is the evening before here).
			start: e.air_at ? new Date(e.air_at).toISOString() : `${e.air_date}T12:00:00.000Z`,
			hasTime: Boolean(e.air_at),
			poster: e.poster,
			mediaId: String(e.tmdb_id),
			source: 'tmdb',
			mediaType: 'tv' as const
		})),
		...films.map((f) => ({
			title: f.title,
			season: null,
			episode: null,
			start: `${f.release_date}T12:00:00.000Z`,
			hasTime: false,
			poster: f.poster,
			mediaId: String(f.tmdb_id),
			source: 'tmdb',
			mediaType: 'movie' as const
		}))
	];
	return items.sort((a, b) => a.start.localeCompare(b.start));
}
