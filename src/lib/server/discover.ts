/**
 * Discover (§6): rows built from TMDB — trending with the daily-format noise
 * stripped, the critically acclaimed, this year's fresh releases, rows tuned to
 * the genres you watch most (from your plays in Seek), and what's coming soon.
 * Everything already on your list is filtered out.
 */
import { allTrackedIds } from './search';
import { memo } from './memo';
import { currentUser } from './userctx';
import { seekStats } from './tracking/stats';
import { dedupe, tmdbConfigured, tmdbDiscover, tmdbGenres, tmdbTrending, type DiscoverParams } from './tmdb';
import type { MediaType, TmdbResult } from '$lib/types';

/** Two TMDB pages concatenated, so a row still fills up after the library and
 *  cross-row duplicates are filtered out. */
const deepDiscover = (p: Omit<DiscoverParams, 'page'>): Promise<TmdbResult[]> =>
	Promise.all([tmdbDiscover({ ...p, page: 1 }), tmdbDiscover({ ...p, page: 2 })]).then(([a, b]) =>
		dedupe([...a, ...b])
	);

export type DiscoverItem = {
	mediaId: string;
	source: string;
	mediaType: 'tv' | 'movie';
	title: string;
	poster: string | null;
	year: number | null;
	rating: number | null;
	/** Already in the library. Rendered as a tick rather than an add button. */
	tracked?: boolean;
};

export type DiscoverRow = {
	key: string;
	title: string;
	why: string | null;
	items: DiscoverItem[];
};

const PER_ROW = 20;
const YEAR = new Date().getFullYear();
const untrackedItems = (list: TmdbResult[], tracked: Set<string>): DiscoverItem[] =>
	list.filter((i) => !tracked.has(i.mediaId)).map((i) => ({ ...i, tracked: false }));

/**
 * Your most-watched genres, as TMDB genre ids, for the "Because you like
 * <Genre>" rows: named by your all-time stats, turned back into filterable ids
 * by TMDB's list. Cached hard — taste barely moves day to day.
 */
function userTopGenres(mediaType: 'tv' | 'movie'): Promise<{ name: string; id: number }[]> {
	const me = currentUser();
	return memo(`discover:genres:${mediaType}`, 6 * 60 * 60 * 1000, async () => {
		if (!tmdbConfigured() || !me) return [];
		try {
			const genreMap = await tmdbGenres(mediaType);
			// Stats split by kind only in the counts, so genres are over everything you watch.
			const seen = new Set<number>();
			const out: { name: string; id: number }[] = [];
			for (const g of seekStats(me.id, me.householdId, 'all_time').topGenres) {
				const id = genreMap.get(g.name.toLowerCase());
				if (id && !seen.has(id)) {
					seen.add(id);
					out.push({ name: g.name, id });
				}
			}
			return out;
		} catch {
			return [];
		}
	});
}

/** The Discover rows. A title only appears in the first row it qualifies for. */
export async function getDiscoverRows(mediaType: MediaType): Promise<DiscoverRow[]> {
	const mt = mediaType === 'movie' ? 'movie' : 'tv';
	if (!tmdbConfigured()) return [];
	const [tracked, topGenres] = await Promise.all([allTrackedIds(mediaType), userTopGenres(mt)]);

	/* A high vote floor is the whole game for TV "acclaimed": TMDB's raw
	   vote_average is topped by niche titles with a few hundred inflated votes
	   (they outrank Breaking Bad), so only titles with thousands of votes count. */
	const genres = topGenres.slice(0, 3);
	const [trending, acclaimed, fresh, soon, ...genreLists] = await Promise.all([
		tmdbTrending(mt),
		deepDiscover({ mediaType: mt, sort: 'top', minVotes: mt === 'tv' ? 2500 : 1500, excludeNoise: true }),
		deepDiscover({ mediaType: mt, sort: 'recommended', yearGte: YEAR, minVotes: 60, excludeNoise: true, notFuture: true }),
		tmdbDiscover({ mediaType: mt, sort: 'recommended', upcomingDays: 90, minVotes: 0, excludeNoise: true }),
		...genres.map((g) =>
			deepDiscover({ mediaType: mt, genres: [g.id], sort: 'recommended', minVotes: 150, excludeNoise: true })
		)
	]);

	const tmdbRow = (key: string, title: string, why: string | null, list: TmdbResult[]): DiscoverRow | null => {
		const items = untrackedItems(list, tracked);
		return items.length ? { key, title, why, items } : null;
	};
	const genreRow = (i: number): DiscoverRow | null =>
		genres[i] ? tmdbRow(`genre_${genres[i].id}`, `Because you like ${genres[i].name}`, null, genreLists[i]) : null;

	const candidates: (DiscoverRow | null)[] = [
		tmdbRow('trending_week', 'Trending This Week', 'What everyone’s watching this week.', trending),
		tmdbRow('acclaimed', 'Critically Acclaimed', 'The highest-rated, most-loved.', acclaimed),
		genreRow(0),
		tmdbRow('new_this_year', `New in ${YEAR}`, 'Popular fresh releases worth a look.', fresh),
		genreRow(1),
		genreRow(2),
		tmdbRow('coming_soon', 'Coming Soon', 'Premieres in the next three months.', soon)
	];

	/* One appearance per title: a show that is trending AND acclaimed shows only
	   in the first row that earned it, so the feed reads as variety rather than
	   the same ten posters restated. Cap each row after de-duping so earlier rows
	   don't starve later ones below their minimum. */
	const seen = new Set<string>();
	const out: DiscoverRow[] = [];
	for (const row of candidates) {
		if (!row) continue;
		const items = row.items.filter((i) => !seen.has(i.mediaId)).slice(0, PER_ROW);
		if (!items.length) continue;
		for (const i of items) seen.add(i.mediaId);
		out.push({ ...row, items });
	}
	return out;
}
