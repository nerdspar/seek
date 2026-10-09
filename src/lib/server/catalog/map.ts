/**
 * Seek's own copy of show and movie info (docs/own-tracking-plan.md, step 1):
 * the pure half — TMDB/TVmaze responses into rows, and when each title is due
 * for a refresh. No I/O here, so it's all unit-tested.
 */

const IMG = 'https://image.tmdb.org/t/p';
const img = (path: unknown, size: string) => (typeof path === 'string' && path ? `${IMG}/${size}${path}` : null);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const names = (v: unknown) =>
	Array.isArray(v) ? v.map((x) => str((x as { name?: unknown })?.name)).filter((x): x is string => x !== null) : [];
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** US flatrate (subscription) providers from TMDB's `watch/providers`. */
function usServices(d: Record<string, unknown>): string[] {
	const us = ((d['watch/providers'] as Record<string, unknown> | undefined)?.results as Record<string, unknown> | undefined)?.US as
		| Record<string, unknown>
		| undefined;
	const flat = Array.isArray(us?.flatrate) ? us.flatrate : [];
	return [...new Set(flat.map((p) => str((p as { provider_name?: unknown })?.provider_name)).filter((n): n is string => n !== null))];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Top-billed cast: shows from aggregate_credits (roles[]), films from credits. */
function castOf(d: Record<string, unknown>): CastMember[] {
	const agg = (d.aggregate_credits ?? d.credits ?? {}) as Record<string, unknown>;
	return (Array.isArray(agg.cast) ? agg.cast : []).slice(0, 20).map((c) => {
		const r = c as Record<string, unknown>;
		const roles = Array.isArray(r.roles) ? r.roles : [];
		return {
			name: str(r.name) ?? '',
			role: str(r.character) ?? str((roles[0] as Record<string, unknown> | undefined)?.character),
			image: img(r.profile_path, 'w185')
		};
	});
}

/** The US age rating: shows from content_ratings, films from release_dates. */
function usCertification(d: Record<string, unknown>): string | null {
	const ratings = ((d.content_ratings as Record<string, unknown> | undefined)?.results ?? []) as Record<string, unknown>[];
	const tv = ratings.find((r) => r.iso_3166_1 === 'US');
	if (tv) return str(tv.rating);
	const releases = ((d.release_dates as Record<string, unknown> | undefined)?.results ?? []) as Record<string, unknown>[];
	const us = releases.find((r) => r.iso_3166_1 === 'US');
	const certs = (Array.isArray(us?.release_dates) ? us.release_dates : []).map((x) => str((x as Record<string, unknown>).certification));
	return certs.find((c) => c !== null) ?? null;
}

/** Keyword names (shows: keywords.results; films: keywords.keywords). */
function keywordNames(d: Record<string, unknown>): string[] {
	const k = (d.keywords ?? {}) as Record<string, unknown>;
	return names(Array.isArray(k.results) ? k.results : k.keywords);
}

export type MediaType = 'tv' | 'movie';

export type TitleRow = {
	mediaType: MediaType;
	tmdbId: number;
	title: string;
	poster: string | null;
	backdrop: string | null;
	/** TMDB's status: Returning Series, Ended, Canceled, In Production, Released… */
	status: string | null;
	genres: string[];
	networks: string[];
	runtime: number | null;
	originCountry: string[];
	originalLanguage: string | null;
	/** First air date (shows) or release date (movies), YYYY-MM-DD. */
	releaseDate: string | null;
	lastAirDate: string | null;
	nextAirDate: string | null;
	tvdbId: number | null;
	imdbId: string | null;
	/** US subscription services, TMDB's names as given (tidied when read). */
	services: string[];
	/** TMDB keywords (the anime rule reads "anime"). */
	keywords: string[];
	overview: string | null;
	vote: number | null;
	voteCount: number | null;
	companies: string[];
	cast: CastMember[];
	/** Shows: each season's name and poster. */
	seasonInfo: SeasonInfo[];
	certification: string | null;
	/** Films: the franchise it belongs to. */
	collection: { id: number; name: string } | null;
};

export type CastMember = { name: string; role: string | null; image: string | null };
export type SeasonInfo = { number: number; name: string | null; poster: string | null; count: number };

export type EpisodeRow = {
	tmdbId: number;
	season: number;
	episode: number;
	title: string | null;
	overview: string | null;
	still: string | null;
	/** TMDB's air date, YYYY-MM-DD (no time). */
	airDate: string | null;
	/** The real air instant, when TVmaze knows it. */
	airAt: string | null;
	runtime: number | null;
};

export type ShowSeasons = { number: number; count: number }[];

/** TMDB `/tv/{id}?append_to_response=external_ids` → a title row, its seasons,
 *  and the season of the latest aired episode. */
export function mapShow(tmdbId: number, d: Record<string, unknown>): { title: TitleRow; seasons: ShowSeasons; lastAiredSeason: number | null } {
	const last = (d.last_episode_to_air ?? null) as Record<string, unknown> | null;
	const next = (d.next_episode_to_air ?? null) as Record<string, unknown> | null;
	const ext = (d.external_ids ?? {}) as Record<string, unknown>;
	const runtimes = Array.isArray(d.episode_run_time) ? d.episode_run_time.filter((n): n is number => typeof n === 'number') : [];
	return {
		title: {
			mediaType: 'tv',
			tmdbId,
			title: str(d.name) ?? str(d.original_name) ?? '',
			poster: img(d.poster_path, 'w500'),
			backdrop: img(d.backdrop_path, 'w780'),
			status: str(d.status),
			genres: names(d.genres),
			networks: names(d.networks),
			runtime: runtimes.length ? runtimes[0] : null,
			originCountry: strings(d.origin_country),
			originalLanguage: str(d.original_language),
			releaseDate: str(d.first_air_date),
			lastAirDate: str(last?.air_date),
			nextAirDate: str(next?.air_date),
			tvdbId: int(ext.tvdb_id),
			imdbId: str(ext.imdb_id),
			services: usServices(d),
			keywords: keywordNames(d),
			overview: str(d.overview),
			vote: num(d.vote_average),
			voteCount: int(d.vote_count),
			companies: names(d.production_companies),
			cast: castOf(d),
			seasonInfo: (Array.isArray(d.seasons) ? d.seasons : [])
				.map((x) => x as Record<string, unknown>)
				.filter((x) => typeof x.season_number === 'number')
				.map((x) => ({ number: x.season_number as number, name: str(x.name), poster: img(x.poster_path, 'w342'), count: int(x.episode_count) ?? 0 })),
			certification: usCertification(d),
			collection: null
		},
		seasons: (Array.isArray(d.seasons) ? d.seasons : [])
			.map((s) => s as Record<string, unknown>)
			.filter((s) => typeof s.season_number === 'number')
			.map((s) => ({ number: s.season_number as number, count: int(s.episode_count) ?? 0 })),
		lastAiredSeason: int(last?.season_number)
	};
}

/** TMDB `/movie/{id}?append_to_response=external_ids` → a title row. */
export function mapMovie(tmdbId: number, d: Record<string, unknown>): TitleRow {
	const ext = (d.external_ids ?? {}) as Record<string, unknown>;
	const countries = strings(d.origin_country);
	return {
		mediaType: 'movie',
		tmdbId,
		title: str(d.title) ?? str(d.original_title) ?? '',
		poster: img(d.poster_path, 'w500'),
		backdrop: img(d.backdrop_path, 'w780'),
		status: str(d.status),
		genres: names(d.genres),
		networks: [],
		runtime: int(d.runtime),
		originCountry: countries.length
			? countries
			: (Array.isArray(d.production_countries) ? d.production_countries : [])
					.map((c) => str((c as { iso_3166_1?: unknown })?.iso_3166_1))
					.filter((c): c is string => c !== null),
		originalLanguage: str(d.original_language),
		releaseDate: str(d.release_date),
		lastAirDate: null,
		nextAirDate: null,
		tvdbId: null,
		imdbId: str(d.imdb_id) ?? str(ext.imdb_id),
		services: usServices(d),
		keywords: keywordNames(d),
		overview: str(d.overview),
		vote: num(d.vote_average),
		voteCount: int(d.vote_count),
		companies: names(d.production_companies),
		cast: castOf(d),
		seasonInfo: [],
		certification: usCertification(d),
		collection: (() => {
			const c = (d.belongs_to_collection ?? null) as Record<string, unknown> | null;
			return c && typeof c.id === 'number' ? { id: c.id, name: str(c.name) ?? '' } : null;
		})()
	};
}

/** TMDB `/tv/{id}/season/{n}` → its episodes. */
export function mapSeason(tmdbId: number, season: number, d: Record<string, unknown>): EpisodeRow[] {
	return (Array.isArray(d.episodes) ? d.episodes : [])
		.map((e) => e as Record<string, unknown>)
		.filter((e) => typeof e.episode_number === 'number')
		.map((e) => ({
			tmdbId,
			season,
			episode: e.episode_number as number,
			title: str(e.name),
			overview: str(e.overview),
			still: img(e.still_path, 'w300'),
			airDate: str(e.air_date),
			airAt: null,
			runtime: int(e.runtime)
		}));
}

export type TvmazeEpisode = { season: number; number: number; airdate: string | null; airstamp: string | null };

const DAY = 24 * 60 * 60 * 1000;

/**
 * Real air times from TVmaze, laid onto TMDB's episodes.
 *
 * Matched on season and number, and only trusted when TVmaze's date is within a
 * day of TMDB's — the two can number differently (anime, absolute order), and a
 * wrong time is worse than none: without one, an episode counts as aired from
 * the start of its date.
 */
export function applyAirTimes(episodes: EpisodeRow[], maze: TvmazeEpisode[]): EpisodeRow[] {
	const byKey = new Map(maze.map((m) => [`${m.season}:${m.number}`, m]));
	return episodes.map((e) => {
		const m = byKey.get(`${e.season}:${e.episode}`);
		if (!m?.airstamp || !e.airDate) return e;
		const tmdbDay = Date.parse(`${e.airDate}T00:00:00Z`);
		const mazeDay = Date.parse(`${m.airdate ?? m.airstamp.slice(0, 10)}T00:00:00Z`);
		if (!Number.isFinite(tmdbDay) || !Number.isFinite(mazeDay) || Math.abs(tmdbDay - mazeDay) > DAY) return e;
		return { ...e, airAt: m.airstamp };
	});
}

/**
 * Which seasons a refresh fetches: any whose episode count changed (or that's
 * new), the season of the latest aired episode (titles and dates still move),
 * and anything after it (upcoming seasons fill in). An ended show refreshed
 * weekly with nothing changed costs one request.
 */
export function seasonsToFetch(stored: Map<number, number>, seasons: ShowSeasons, lastAiredSeason: number | null): number[] {
	return seasons
		.filter((s) => stored.get(s.number) !== s.count || (lastAiredSeason !== null && s.number >= lastAiredSeason))
		.map((s) => s.number);
}

const HOUR = 60 * 60 * 1000;

/**
 * When a title is next due. Airing shows (an episode in the last 7 days or the
 * next 14) hourly, so a premiere lands within the hour; returning shows between
 * seasons daily; ended shows and movies weekly. A failure retries in an hour.
 */
export function refreshAfter(t: Pick<TitleRow, 'mediaType' | 'status' | 'lastAirDate' | 'nextAirDate'>, now: number): number {
	if (t.mediaType === 'movie') return now + 7 * DAY;
	if (t.status === 'Ended' || t.status === 'Canceled') return now + 7 * DAY;
	const last = t.lastAirDate ? Date.parse(`${t.lastAirDate}T00:00:00Z`) : NaN;
	const next = t.nextAirDate ? Date.parse(`${t.nextAirDate}T00:00:00Z`) : NaN;
	const airing = (Number.isFinite(last) && now - last <= 7 * DAY) || (Number.isFinite(next) && next - now <= 14 * DAY);
	return airing ? now + HOUR : now + DAY;
}
