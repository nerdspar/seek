/**
 * Profile statistics (§7.1). **Seek computes nothing.** Every number here is
 * read from Floppy's overview endpoint; the only local arithmetic is turning a
 * named range into the start/end dates the endpoint wants.
 *
 * §7.1 expected binge rhythm, streaks and finish rate to be missing. They are
 * not — Floppy reports current_streak, longest_streak, most_active_day and a
 * by-weekday hours chart, so all of it ships.
 *
 * Range note: `range=` and `period=` are silently ignored; only explicit
 * `start_date`/`end_date` narrow the window.
 */
import { floppy } from './floppy';

export type RangeKey = 'this_month' | 'this_year' | 'last_year' | 'all_time';

export type TopTitle = {
	title: string;
	poster: string | null;
	mediaId: string;
	source: string;
	duration: string;
	plays: number | null;
};

export type Stats = {
	rangeLabel: string;
	hours: number;
	plays: number;
	minutes: number;
	counts: { tv: number; movie: number; anime: number; total: number };
	completed: number;
	currentStreak: number;
	longestStreak: number;
	mostActiveDay: string | null;
	mostActiveDayPct: number | null;
	weekday: { label: string; hours: number }[];
	topGenres: { name: string; duration: string }[];
	topTitles: TopTitle[];
	topStudios: { name: string; watched: string; shows: number }[];
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Named range → the explicit dates the endpoint actually honours. */
export function rangeDates(key: RangeKey, now = new Date()): { start?: string; end?: string; label: string } {
	const iso = (d: Date) => d.toISOString().slice(0, 10);
	const y = now.getFullYear();

	switch (key) {
		case 'this_month':
			return {
				start: iso(new Date(y, now.getMonth(), 1)),
				end: iso(new Date(y, now.getMonth() + 1, 0)),
				label: 'This month'
			};
		case 'this_year':
			return { start: `${y}-01-01`, end: `${y}-12-31`, label: 'This year' };
		case 'last_year':
			return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31`, label: 'Last year' };
		default:
			return { label: 'All time' };
	}
}

export async function getStats(key: RangeKey): Promise<Stats> {
	const { start, end, label } = rangeDates(key);
	const res = rec(
		await floppy('/api/v1/statistics/overview/', {
			query: { start_date: start, end_date: end },
			// This endpoint genuinely takes ~9.4s for an all-time range and returns
			// ~500 KB. The 15s default is not enough headroom when Floppy is also
			// serving something else, and a timeout here renders as a broken tab.
			timeoutMs: 90_000
		})
	);

	const st = rec(res.statistics);
	const summary = rec(rec(st.summary_stats_by_type).all);
	const consumption = rec(rec(st.consumption_stats_by_type).all);
	const counts = rec(st.media_count);
	const tv = rec(st.tv_consumption);

	const weekdayAll = rec(rec(rec(st.combined_plays_charts).by_weekday).all);
	const labels = arr(weekdayAll.labels).map(String);
	const values = arr(arr(weekdayAll.datasets)[0] ? rec(arr(weekdayAll.datasets)[0]).data : []);

	return {
		rangeLabel: str(rec(res.range).range_name) ?? label,
		hours: Math.round(num(rec(consumption.primary).total)),
		plays: Math.round(num(rec(consumption.secondary).total)),
		minutes: num(summary.total_minutes),
		counts: {
			tv: num(counts.tv),
			movie: num(counts.movie),
			anime: num(counts.anime),
			total: num(counts.total)
		},
		completed: num(summary.completed),
		currentStreak: num(summary.current_streak),
		longestStreak: num(summary.longest_streak),
		mostActiveDay: str(summary.most_active_day),
		mostActiveDayPct: typeof summary.most_active_day_percentage === 'number'
			? summary.most_active_day_percentage
			: null,
		weekday: labels.map((l, i) => ({ label: l, hours: num(values[i]) })),
		topGenres: arr(tv.top_genres)
			.slice(0, 6)
			.map((g) => {
				const r = rec(g);
				return { name: str(r.name) ?? '', duration: str(r.formatted_duration) ?? '' };
			})
			.filter((g) => g.name),
		topTitles: arr(rec(st.top_played).tv)
			.slice(0, 5)
			.map((t): TopTitle | null => {
				const r = rec(t);
				const item = rec(rec(r.media).item);
				const mediaId = str(item.media_id);
				if (!mediaId) return null;
				return {
					title: str(item.title) ?? 'Untitled',
					poster: str(item.image),
					mediaId,
					source: str(item.source) ?? 'tmdb',
					duration: str(r.formatted_duration) ?? '',
					plays: typeof r.episode_count === 'number' ? r.episode_count : null
				};
			})
			.filter((t): t is TopTitle => t !== null),
		topStudios: arr(rec(st.top_talent).top_studios)
			.slice(0, 5)
			.map((s) => {
				const r = rec(s);
				return {
					name: str(r.name) ?? '',
					watched: str(r.watched_time) ?? '',
					shows: num(r.unique_shows)
				};
			})
			.filter((s) => s.name)
	};
}

/* ── Diary (§7.3) ──────────────────────────────────────────────────────── */

export type DiaryEntry = {
	/** The SHOW's name. "Lincoln" alone tells you nothing about which show. */
	showTitle: string;
	/** The episode's own title. */
	episodeTitle: string | null;
	poster: string | null;
	mediaId: string | null;
	source: string | null;
	/** Preformatted by Floppy, e.g. "S06E14". */
	code: string | null;
	/** Local wall-clock with offset, e.g. 2026-08-23T21:09:00-04:00. */
	playedAt: string | null;
	runtime: string | null;
};

export type DiaryDay = {
	date: string;
	label: string;
	total: string | null;
	entries: DiaryEntry[];
};

export async function getDiary(offset = 0, limit = 20): Promise<{ days: DiaryDay[]; hasMore: boolean }> {
	const res = rec(await floppy('/api/v1/history/', { query: { limit, offset } }));

	const days = arr(res.results).map((raw): DiaryDay => {
		const d = rec(raw);
		return {
			date: str(d.date) ?? '',
			label: str(d.date_display) ?? str(d.date) ?? '',
			total: str(d.total_runtime_display),
			// Everything useful sits at the ENTRY level, not under `item` — the
			// nested item carries the episode's title and the show's media_id,
			// while `show`, `poster`, `episode_code` and `played_at_local` are
			// siblings of it.
			entries: arr(d.entries).map((e): DiaryEntry => {
				const entry = rec(e);
				const item = rec(entry.item);
				const show = rec(entry.show);
				return {
					showTitle: str(show.title) ?? str(entry.display_title) ?? 'Untitled',
					episodeTitle: str(entry.title),
					poster: str(entry.poster) ?? str(show.image),
					// §12.2: on an episode row this is the SHOW's id, which is what
					// the link needs.
					mediaId: str(item.media_id),
					source: str(item.source),
					code: str(entry.episode_code),
					playedAt: str(entry.played_at_local),
					runtime: str(entry.runtime_display)
				};
			})
		};
	});

	return { days, hasMore: Boolean(rec(res.pagination).next) };
}
