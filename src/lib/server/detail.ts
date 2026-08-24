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
	SeasonDetail,
	SeasonSummary,
	ShowDetail
} from '$lib/types';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const showPath = (source: string, mediaId: string) =>
	`/api/v1/media/tv/${source}/${encodeURIComponent(mediaId)}`;

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

async function seasonMax(
	source: string,
	mediaId: string,
	seasonNumber: number
): Promise<number | null> {
	const key = `${source}:${mediaId}:${seasonNumber}`;
	const hit = seasonMaxCache.get(key);
	if (hit !== undefined) return hit;

	try {
		const d = await floppy<{ max_progress: number | null }>(
			`${showPath(source, mediaId)}/${seasonNumber}/`
		);
		const max = typeof d?.max_progress === 'number' ? d.max_progress : null;
		seasonMaxCache.set(key, max);
		return max;
	} catch {
		return null;
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

export async function getShow(source: string, mediaId: string): Promise<ShowDetail> {
	const d = rec(await floppy(`${showPath(source, mediaId)}/`));
	const details = rec(d.details);
	const related = rec(d.related);

	const seasons: SeasonSummary[] = arr(related.seasons)
		.map((entry): SeasonSummary | null => {
			const s = rec(entry);
			const item = rec(s.item);
			const seasonNumber = num(item.season_number);
			if (seasonNumber === null) return null;
			return {
				seasonNumber,
				title: str(item.title) ?? `Season ${seasonNumber}`,
				poster: str(item.image),
				progress: num(s.progress),
				maxProgress: num(item.number_of_pages),
				// `id` is null for a season the user has never tracked.
				tracked: s.id !== null && s.id !== undefined
			};
		})
		.filter((s): s is SeasonSummary => s !== null)
		.sort((a, b) => a.seasonNumber - b.seasonNumber);

	// Fill the missing episode counts concurrently.
	const withTotals = await Promise.all(
		seasons.map(async (s) =>
			s.maxProgress === null
				? { ...s, maxProgress: await seasonMax(source, mediaId, s.seasonNumber) }
				: s
		)
	);

	// The show's own consumption row carries total episodes watched.
	const consumption = rec(arr(d.consumptions)[0]);

	// Seed the title cache so a season page opened from here costs no extra call.
	const title = str(d.title) ?? 'Untitled';
	showTitleCache.set(`${source}:${mediaId}`, title);

	return {
		mediaId: str(d.media_id) ?? mediaId,
		source: str(d.source) ?? source,
		title,
		poster: str(d.image),
		synopsis: str(d.synopsis),
		genres: arr(d.genres).filter((g): g is string => typeof g === 'string'),
		score: num(d.score),
		scoreCount: num(d.score_count),
		maxProgress: num(d.max_progress),
		progress: num(consumption.progress) ?? 0,
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
		seasons: withTotals
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
		floppy(`${showPath(source, mediaId)}/${seasonNumber}/`).then(rec),
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
