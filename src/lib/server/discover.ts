/**
 * Discover (§6). Floppy's own rows come first — its personalisation is already
 * doing the work §6.1 describes, including "because you watched"-style rows
 * driven by local history ("Top Picks For You", "Comfort Rewatches"), each with
 * a `why` explaining itself. Rolling our own on top would be worse and slower.
 *
 * Floppy also returns `match_signal`, which is deliberately dropped. Every row
 * that has one phrases it as "Driven by your current <tags> phase" using the
 * same handful of tags in a different order, so on screen the rows all appeared
 * to say the same thing.
 */
import { floppy } from './floppy';
import { allTrackedIds } from './search';
import { memo } from './memo';
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
	/** Floppy's own explanation of what drove a personalised row. */
	items: DiscoverItem[];
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function mapItem(raw: unknown): DiscoverItem | null {
	const i = rec(raw);
	const mediaId = String(i.media_id ?? '');
	if (!mediaId) return null;
	const mt = str(i.media_type);
	const release = str(i.release_date);
	return {
		mediaId,
		source: str(i.source) ?? 'tmdb',
		mediaType: mt === 'movie' ? 'movie' : 'tv',
		title: str(i.title) ?? 'Untitled',
		poster: str(i.image),
		year: release && release.length >= 4 ? Number(release.slice(0, 4)) : null,
		rating: typeof i.rating === 'number' ? Math.round(i.rating * 10) / 10 : null
	};
}

const PER_ROW = 20;
const YEAR = new Date().getFullYear();
const untrackedItems = (list: TmdbResult[], tracked: Set<string>): DiscoverItem[] =>
	list.filter((i) => !tracked.has(i.mediaId)).map((i) => ({ ...i, tracked: false }));

/**
 * The user's most-watched genres, as TMDB genre ids, for the "Because you like
 * <Genre>" rows. Floppy's stats name the genres; TMDB's list turns the names
 * back into filterable ids. Cached hard — taste barely moves day to day.
 */
function userTopGenres(mediaType: 'tv' | 'movie'): Promise<{ name: string; id: number }[]> {
	return memo(`discover:genres:${mediaType}`, 6 * 60 * 60 * 1000, async () => {
		if (!tmdbConfigured()) return [];
		try {
			const [overview, genreMap] = await Promise.all([
				// This endpoint takes ~9s and needs real headroom (see stats.ts).
				floppy(`/api/v1/statistics/overview/`, { timeoutMs: 90_000 }).then(rec),
				tmdbGenres(mediaType)
			]);
			const st = rec(rec(overview).statistics);
			const cons = rec(mediaType === 'movie' ? st.movie_consumption : st.tv_consumption);
			const seen = new Set<number>();
			const out: { name: string; id: number }[] = [];
			for (const g of arr(cons.top_genres)) {
				const name = str(rec(g).name);
				const id = name ? genreMap.get(name.toLowerCase()) : undefined;
				if (id && !seen.has(id)) {
					seen.add(id);
					out.push({ name: name as string, id });
				}
			}
			return out;
		} catch {
			return [];
		}
	});
}

/** Pull one of Floppy's own rows through untouched (its personalisation is real
 *  and we have no better version of "Top Picks" or "Coming Soon"). */
function floppyRow(
	rowsByKey: Map<string, Rec>,
	key: string,
	fallbackTitle: string,
	tracked: Set<string>
): DiscoverRow | null {
	const r = rowsByKey.get(key);
	if (!r) return null;
	const items = arr(r.items)
		.map(mapItem)
		.filter((i): i is DiscoverItem => i !== null)
		.filter((i) => !tracked.has(i.mediaId))
		.map((i) => ({ ...i, tracked: false }));
	if (!items.length) return null;
	return { key, title: str(r.title) ?? fallbackTitle, why: str(r.why), items };
}

/**
 * Discover (§6) — a screen to find something new to watch without leaving the
 * app. Floppy's raw feed is half library rows (your in-progress and completed
 * shows) and a talk-show-clogged "trending", so this keeps only its two genuine
 * discovery rows (Top Picks, Coming Soon) and builds the rest from TMDB:
 * trending with the daily-format noise stripped, the critically acclaimed, this
 * year's fresh releases, hidden gems, and rows tuned to the genres you watch
 * most. Everything already in the library is filtered out, and a title only
 * appears in the first row it qualifies for.
 */
export async function getDiscoverRows(mediaType: MediaType): Promise<DiscoverRow[]> {
	const mt = mediaType === 'movie' ? 'movie' : 'tv';
	const [floppyRes, tracked, topGenres] = await Promise.all([
		floppy(`/api/v1/discover/`, { query: { media_type: mediaType } })
			.then(rec)
			.catch(() => ({}) as Rec),
		allTrackedIds(mediaType),
		userTopGenres(mt)
	]);
	const rowsByKey = new Map(
		arr(floppyRes.rows).map((raw): [string, Rec] => {
			const r = rec(raw);
			return [str(r.key) ?? '', r];
		})
	);

	// No TMDB key: fall back to Floppy's feed rather than a near-empty screen.
	if (!tmdbConfigured()) return legacyFloppyRows(rowsByKey, tracked);

	/* A high vote floor is the whole game for TV "acclaimed": TMDB's raw
	   vote_average is topped by niche titles with a few hundred inflated votes
	   (they outrank Breaking Bad), so only titles with thousands of votes count. */
	const genres = topGenres.slice(0, 3);
	const [trending, acclaimed, fresh, ...genreLists] = await Promise.all([
		tmdbTrending(mt),
		deepDiscover({ mediaType: mt, sort: 'top', minVotes: mt === 'tv' ? 2500 : 1500, excludeNoise: true }),
		deepDiscover({ mediaType: mt, sort: 'recommended', yearGte: YEAR, minVotes: 60, excludeNoise: true, notFuture: true }),
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
		floppyRow(rowsByKey, 'coming_soon', 'Coming Soon', tracked)
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

/** Pre-TMDB behaviour, used only when no key is configured. */
function legacyFloppyRows(rowsByKey: Map<string, Rec>, tracked: Set<string>): DiscoverRow[] {
	const ABOUT_YOUR_LIBRARY = new Set(['top_picks_for_you', 'clear_out_next', 'comfort_rewatches']);
	const out: DiscoverRow[] = [];
	for (const [key, r] of rowsByKey) {
		const all = arr(r.items)
			.map(mapItem)
			.filter((i): i is DiscoverItem => i !== null)
			.map((i) => ({ ...i, tracked: tracked.has(i.mediaId) }));
		const items = ABOUT_YOUR_LIBRARY.has(key) ? all : all.filter((i) => !i.tracked);
		if (!items.length) continue;
		out.push({ key, title: str(r.title) ?? 'More', why: str(r.why), items });
	}
	return out;
}
