/**
 * Show, season and episode detail (§4.4, §6.1). Server-only.
 *
 * The important shape fact, verified live rather than assumed (§12.6):
 * on the show endpoint `details.seasons` and `details.episodes` are **counts**,
 * not arrays. The actual lists live under `related`:
 *
 *   show   → related.seasons[]   — TrackedMedia-shaped, one per season
 *   season → related.episodes[]  — TrackedMedia-shaped, one per episode
 *
 * Hardcoding `details.seasons` as an array would have silently produced empty
 * season lists. Everything below maps into Seek's own types so no component has
 * to know any of this.
 */
import { floppy } from './floppy';
import { TTLCache } from './cache';
import type {
	EpisodeDetail,
	EpisodeRow,
	MovieDetail,
	SeasonDetail,
	SeasonSummary,
	ShowDetail
} from '$lib/types';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Floppy's status code for Completed (0 Planning, 1 In progress, 2 Paused, 4 Dropped). */
const FLOPPY_COMPLETED = 3;

const showPath = (source: string, mediaId: string) =>
	`/api/v1/media/tv/${source}/${encodeURIComponent(mediaId)}`;

/** Fetch a TV detail (a show or one of its seasons). Anime is tracked in the
 *  plain `tv` library like everything else now (the Shows/Anime split is a
 *  tag, see anime-sync.ts), so there is no separate bucket to
 *  reach into. */
async function fetchTvDetail(path: string): Promise<Record<string, unknown>> {
	return rec(await floppy(path));
}

/**
 * A film's detail. Its own function rather than a branch inside getShow: the
 * expensive half of that one is resolving per-season episode counts, and none
 * of it applies here.
 *
 * Verified against a live instance: the movie endpoint returns the same
 * envelope as the tv one — cast, genres, synopsis, score, tracked — with
 * `details` carrying release_date, runtime, status, studios and certification,
 * and `max_progress` of 1.
 */
export async function getMovie(source: string, mediaId: string): Promise<MovieDetail> {
	const d = rec(await floppy(`/api/v1/media/movie/${source}/${encodeURIComponent(mediaId)}/`));
	const details = rec(d.details);
	const consumption = rec(arr(d.consumptions)[0]);

	/* `related` holds the franchise under a key named after it — "Toy Story
	   Collection" rather than "collection" — so it has to be discovered rather
	   than looked up. Its entries are flat, not wrapped in `item` the way season
	   rows are, and their `id` is null even for films you track, so tracked state
	   has to come from elsewhere. */
	const related = rec(d.related);
	const [collectionName, collectionRaw] =
		Object.entries(related).find(([, v]) => Array.isArray(v) && v.length) ?? [];
	const collection = collectionName
		? {
				name: collectionName,
				items: arr(collectionRaw)
					.map((entry) => {
						const c = rec(entry);
						return {
							mediaId: String(c.media_id ?? ''),
							source: str(c.source) ?? 'tmdb',
							title: str(c.title) ?? 'Untitled',
							poster: str(c.image),
							year: num(c.year)
						};
					})
					.filter((c) => c.mediaId)
			}
		: null;

	return {
		mediaId: str(d.media_id) ?? mediaId,
		source: str(d.source) ?? source,
		sourceUrl: str(d.source_url),
		title: str(d.title) ?? 'Untitled',
		poster: str(d.image),
		synopsis: str(d.synopsis),
		genres: arr(d.genres).filter((g): g is string => typeof g === 'string'),
		score: num(d.score),
		scoreCount: num(d.score_count),
		maxProgress: num(d.max_progress),
		progress: num(consumption.progress) ?? 0,
		watched: (num(consumption.progress) ?? 0) > 0 || Boolean(str(consumption.end_date)),
		tracked: d.tracked === true,
		status: str(details.status),
		releaseDate: str(details.release_date),
		studios: arr(details.studios).filter((x): x is string => typeof x === 'string'),
		runtime: num(details.runtime),
		certification: str(details.certification),
		cast: arr(d.cast)
			.slice(0, 20)
			.map((c) => {
				const p = rec(c);
				return { name: str(p.name) ?? '', role: str(p.role), image: str(p.image) };
			})
			.filter((c) => c.name),
		// One entry means the film is alone in its "collection"; not worth a rail.
		collection: collection && collection.items.length > 1 ? collection : null
	};
}

/**
 * Per-season episode counts.
 *
 * `related.seasons[]` reports `progress` but never a total — `number_of_pages`
 * is null on every season entry — so the season rows would render an empty
 * progress bar and a bare "12 watched". The count lives on each season's own
 * detail endpoint as `max_progress`, so they are fetched in parallel and
 * cached; a finished show's season lengths never change.
 */
const seasonMaxCache = new TTLCache<number | null>(6 * 60 * 60 * 1000, 4000);

type SeasonStats = { max: number | null; watched: number | null };

/** Whether per-season progress should be derived from episode plays rather than
 *  trusted from Floppy's season summaries. True only when the show's own watched
 *  total exceeds what its seasons report — the signature of a grouped/absolute
 *  show (Re:ZERO), where Floppy leaves the per-season progress null. A normal show
 *  whose per-season counts already sum to its total returns false, so it never
 *  pays for the extra per-season fetch. */
export function shouldDeriveProgress(
	showProgress: number,
	perSeasonProgress: (number | null)[]
): boolean {
	let sum = 0;
	for (const p of perSeasonProgress) sum += p ?? 0;
	return showProgress > sum;
}

/**
 * A season's episode total and watched count, from its own detail endpoint.
 *
 * `max` (episode count) is stable, so it is cached. `watched` is counted from the
 * episodes' play counts and is *not* cached — it changes when you mark an episode,
 * and the show memo is invalidated on a watch change, so it is re-read then. This
 * is the only reliable source of per-season progress for grouped/absolute shows
 * (Re:ZERO), where Floppy leaves the season-level progress field null.
 */
async function seasonStats(
	source: string,
	mediaId: string,
	seasonNumber: number
): Promise<SeasonStats> {
	const key = `${source}:${mediaId}:${seasonNumber}`;
	try {
		const d = rec(await floppy(`${showPath(source, mediaId)}/${seasonNumber}/`));
		const max = num(d.max_progress);
		seasonMaxCache.set(key, max);
		const eps = arr(rec(d.related).episodes);
		const watched = eps.length ? eps.filter((e) => (num(rec(e).progress) ?? 0) > 0).length : null;
		return { max, watched };
	} catch {
		return { max: seasonMaxCache.get(key) ?? null, watched: null };
	}
}

function mapEpisode(entry: unknown): EpisodeRow | null {
	const e = rec(entry);
	const item = rec(e.item);
	const episodeNumber = num(item.episode_number);
	const seasonNumber = num(item.season_number);
	if (episodeNumber === null || seasonNumber === null) return null;

	return {
		seasonNumber,
		episodeNumber,
		title: str(item.title) ?? `Episode ${episodeNumber}`,
		synopsis: str(item.synopsis),
		still: str(item.image),
		runtime: num(item.runtime_minutes),
		airDate: str(item.release_datetime),
		// `progress` on an episode row is its play count: 0 unwatched, 2 rewatched.
		plays: num(e.progress) ?? 0
	};
}

export async function getShow(
	source: string,
	mediaId: string,
	/** Episode counts per season, if a cheaper source already has them. Supplying
	 *  these skips a per-season request each — the dominant cost of this page. */
	knownSeasonEpisodes: Record<number, number> = {},
	/** The latest episode that has aired (TMDB's last_episode_to_air), so a
	 *  whole-season action can stop at what's out. Null → treat every listed
	 *  episode as aired (an ended show, or no air data). */
	lastAired: { season: number; episode: number } | null = null
): Promise<ShowDetail> {
	const d = await fetchTvDetail(`${showPath(source, mediaId)}/`);
	const details = rec(d.details);
	const related = rec(d.related);

	/* Floppy's season `progress` is the furthest episode reached, not a count:
	   watch only E10 and it says 10, with 0 left. Only a Completed season's
	   number is a true count; any other season with a position is counted from
	   its ticked episodes below (normally just the one you're watching). */
	const inProgress = new Set<number>();
	const seasons: SeasonSummary[] = arr(related.seasons)
		.map((entry): SeasonSummary | null => {
			const s = rec(entry);
			const item = rec(s.item);
			const seasonNumber = num(item.season_number);
			if (seasonNumber === null) return null;
			if ((num(s.progress) ?? 0) > 0 && num(s.status) !== FLOPPY_COMPLETED) inProgress.add(seasonNumber);
			return {
				seasonNumber,
				title: str(item.title) ?? `Season ${seasonNumber}`,
				poster: str(item.image),
				progress: num(s.progress),
				maxProgress: num(item.number_of_pages),
				// Filled in below, once maxProgress is settled.
				airedMax: null,
				// `id` is null for a season the user has never tracked.
				tracked: s.id !== null && s.id !== undefined
			};
		})
		.filter((s): s is SeasonSummary => s !== null)
		.sort((a, b) => a.seasonNumber - b.seasonNumber);

	// The show's own consumption row carries total episodes watched — read here
	// because the per-season progress derivation below compares against it.
	const consumption = rec(arr(d.consumptions)[0]);
	const showProgress = num(consumption.progress) ?? 0;

	/* Floppy leaves per-season `progress` null for grouped/absolute shows (Re:ZERO),
	   so those rows read "Not started" though their episodes are watched. Derive the
	   count from episode plays — but only when the show clearly has watches the
	   seasons don't account for, so normal shows (whose per-season sum already equals
	   the show total) never pay for the extra per-season fetch. */
	const deriveProgress = shouldDeriveProgress(
		showProgress,
		seasons.map((s) => s.progress)
	);

	/* Fill the missing episode counts (and, when deriving, the watched counts).
	   Anything the caller already knows costs nothing; the rest falls back to one
	   request per season, which is what made this page slow before TMDB supplied
	   the counts — so a season is only fetched when it actually needs something. */
	const withTotals = await Promise.all(
		seasons.map(async (s) => {
			const known = knownSeasonEpisodes[s.seasonNumber];
			const needMax = s.maxProgress === null && typeof known !== 'number';
			const needProg = (deriveProgress && s.progress === null) || inProgress.has(s.seasonNumber);
			if (!needMax && !needProg) {
				return { ...s, maxProgress: s.maxProgress ?? (typeof known === 'number' ? known : null) };
			}
			const stats = await seasonStats(source, mediaId, s.seasonNumber);
			return {
				...s,
				maxProgress: s.maxProgress ?? (typeof known === 'number' ? known : stats.max),
				progress: needProg ? (stats.watched ?? s.progress) : s.progress
			};
		})
	);

	/* How many episodes of each season have actually aired, so a whole-season mark
	   can stop there instead of ticking episodes that have not aired. A past season
	   is fully aired; the currently-airing one stops at lastAired's episode; a
	   season that has not started has none. With no air data (an ended show) every
	   listed episode counts as aired. */
	const airedMaxFor = (seasonNumber: number, maxProgress: number | null): number | null => {
		if (maxProgress === null) return null;
		if (!lastAired || seasonNumber < lastAired.season) return maxProgress;
		if (seasonNumber === lastAired.season) return Math.min(maxProgress, lastAired.episode);
		return 0;
	};
	const withAired: SeasonSummary[] = withTotals.map((s) => ({
		...s,
		airedMax: airedMaxFor(s.seasonNumber, s.maxProgress)
	}));

	// Seed the title cache so a season page opened from here costs no extra call.
	const title = str(d.title) ?? 'Untitled';
	showTitleCache.set(`${source}:${mediaId}`, title);

	return {
		mediaId: str(d.media_id) ?? mediaId,
		source: str(d.source) ?? source,
		sourceUrl: str(d.source_url),
		title,
		poster: str(d.image),
		synopsis: str(d.synopsis),
		genres: arr(d.genres).filter((g): g is string => typeof g === 'string'),
		score: num(d.score),
		scoreCount: num(d.score_count),
		maxProgress: num(d.max_progress),
		// The show total is "furthest" too: move it by whatever counting changed.
		progress: Math.max(
			0,
			showProgress +
				withTotals.reduce(
					(n, t, i) => (inProgress.has(t.seasonNumber) ? n + (t.progress ?? 0) - (seasons[i].progress ?? 0) : n),
					0
				)
		),
		tracked: d.tracked === true,
		status: str(details.status),
		firstAirDate: str(details.first_air_date),
		lastAirDate: str(details.last_air_date),
		studios: arr(details.studios).filter((s): s is string => typeof s === 'string'),
		runtime: num(details.runtime),
		cast: arr(d.cast)
			.slice(0, 20)
			.map((c) => {
				const p = rec(c);
				return { name: str(p.name) ?? '', role: str(p.role), image: str(p.image) };
			})
			.filter((c) => c.name),
		seasons: withAired
	};
}

/**
 * The season endpoint has no show title — `title` is "Season 6" and the only
 * pointer upward is `parent_id`. The season page needs the show's name for its
 * header, so it is read from the show endpoint and cached; titles are stable.
 */
const showTitleCache = new TTLCache<string | null>(24 * 60 * 60 * 1000, 2000);

async function showTitle(source: string, mediaId: string): Promise<string | null> {
	const key = `${source}:${mediaId}`;
	const hit = showTitleCache.get(key);
	if (hit !== undefined) return hit;

	try {
		const d = await floppy<{ title: string | null }>(`${showPath(source, mediaId)}/`);
		const title = d?.title ?? null;
		showTitleCache.set(key, title);
		return title;
	} catch {
		return null;
	}
}

export async function getSeason(
	source: string,
	mediaId: string,
	seasonNumber: number
): Promise<SeasonDetail> {
	const [d, parentTitle] = await Promise.all([
		fetchTvDetail(`${showPath(source, mediaId)}/${seasonNumber}/`),
		showTitle(source, mediaId)
	]);
	const related = rec(d.related);
	const consumption = rec(arr(d.consumptions)[0]);

	return {
		mediaId: str(d.media_id) ?? mediaId,
		source: str(d.source) ?? source,
		seasonNumber,
		title: str(d.title) ?? `Season ${seasonNumber}`,
		showTitle: parentTitle,
		poster: str(d.image),
		maxProgress: num(d.max_progress),
		progress: num(consumption.progress) ?? 0,
		episodes: arr(related.episodes)
			.map(mapEpisode)
			.filter((e): e is EpisodeRow => e !== null)
			.sort((a, b) => a.episodeNumber - b.episodeNumber)
	};
}

export async function getEpisode(
	source: string,
	mediaId: string,
	seasonNumber: number,
	episodeNumber: number
): Promise<EpisodeDetail> {
	const d = rec(
		await floppy(`${showPath(source, mediaId)}/${seasonNumber}/${episodeNumber}/`)
	);
	// The episode endpoint puts the numbers inside `details`, which IS typed in
	// the contract — air_date, runtime, episode_number, season_number are stable.
	const details = rec(d.details);

	return {
		mediaId: str(d.media_id) ?? mediaId,
		source: str(d.source) ?? source,
		showTitle: null,
		seasonNumber: num(details.season_number) ?? seasonNumber,
		episodeNumber: num(details.episode_number) ?? episodeNumber,
		title: str(d.title) ?? `Episode ${episodeNumber}`,
		synopsis: str(d.synopsis),
		still: str(d.image),
		runtime: num(details.runtime),
		airDate: str(details.air_date),
		plays: num(d.consumptions_number) ?? 0
	};
}
