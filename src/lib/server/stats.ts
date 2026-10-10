/**
 * Profile statistics (§7.1), the collection counts (§7.2) and the diary (§7.3),
 * worked out from your plays in Seek (tracking/stats.ts). Same exports the
 * Profile has always used.
 */
import { currentUser } from './userctx';
import { seekCollectionCounts, seekDiary, seekStats } from './tracking/stats';

export type RangeKey = 'this_month' | 'this_year' | 'last_year' | 'all_time';

export type RatedTitle = {
	title: string;
	poster: string | null;
	mediaId: string;
	source: string;
	mediaType: 'tv' | 'movie';
	score: number;
};

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
	/** Hours per calendar month for the window, split by type — the Profile chart.
	 *  `labels` are month names; each series is the same length. */
	monthly: { labels: string[]; all: number[]; tv: number[]; movie: number[] };
	topGenres: { name: string; pct: number; hours: number }[];
	topTitles: TopTitle[];
	/** What you rated highest. Empty until you rate something. */
	topRated: RatedTitle[];
	topStudios: { name: string; pct: number; hours: number; shows: number }[];
};

/** Named range → its dates. */
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
	const me = currentUser();
	if (!me) throw new Error('getStats needs a person');
	return seekStats(me.id, me.householdId, key);
}

/* ── Collection counts (§7.2) ──────────────────────────────────────────── */

export type CollectionCounts = { tv: number; movie: number; anime: number };

export async function getCollectionCounts(): Promise<CollectionCounts> {
	const me = currentUser();
	return me ? seekCollectionCounts(me.id, me.householdId) : { tv: 0, movie: 0, anime: 0 };
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
	/** Which detail page this row belongs to — the diary holds films as well as
	 *  episodes, and they live on different routes. */
	mediaType: 'tv' | 'movie';
	/** e.g. "S06E14". */
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

export async function getDiary(offset = 0, limit = 20): Promise<{ days: DiaryDay[]; hasMore: boolean; total: number }> {
	const me = currentUser();
	return me ? seekDiary(me.id, me.householdId, offset, limit) : { days: [], hasMore: false, total: 0 };
}
