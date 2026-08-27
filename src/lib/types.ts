/** Mirrors openapi.yaml components/schemas on Floppy v26.8.20. */

export type MediaType = 'tv' | 'movie' | 'anime';

/** Floppy stores user status as an int; the list endpoint also accepts labels. */
export const Status = {
	Planning: 0,
	InProgress: 1,
	Paused: 2,
	Completed: 3,
	Dropped: 4
} as const;

export type NextEpisode = {
	season_number: number | null;
	episode_number: number;
	air_date: string | null;
};

export type TrackedMedia = {
	id: number | null;
	consumption_id: number | null;
	item: Record<string, unknown> | null;
	item_id: string | null;
	parent_id: string | null;
	tracked: boolean;
	created_at: string | null;
	score: number | null;
	status: number | null;
	progress: number | null;
	progress_scope: string | null;
	progress_unit: string | null;
	progressed_at: string | null;
	start_date: string | null;
	end_date: string | null;
	notes: string | null;
	lists: Record<string, unknown>[];
	next_episode: NextEpisode | null;
};

export type Consumption = {
	consumption_id: number;
	created: string | null;
	score: number | null;
	progress: number | null;
	progressed_at: string | null;
	status: number | null;
	start_date: string | null;
	end_date: string | null;
	notes: string | null;
};

/** Typed in the contract — unlike show-level `details`, safe to bind to (§12.6). */
export type EpisodeDetails = {
	air_date: string | null;
	episode_number: number;
	season_number: number;
	runtime: number | null;
	episode_type: string | null;
	crew: Record<string, unknown>[];
	guest_stars: Record<string, unknown>[];
};

export type CompleteEpisode = {
	id: number | null;
	media_id: string | null;
	source: string | null;
	media_type: string;
	title: string | null;
	max_progress: number;
	image: string | null;
	synopsis: string | null;
	details: EpisodeDetails;
	tracked: boolean;
	consumptions_number: number;
	consumptions: Consumption[];
};

export type FloppyInfo = {
	version: string;
	debug: boolean;
	frontend_url: string;
	language: string;
	timezone: string;
	admin_enabled: boolean;
	track_time: boolean;
};

/** The shape Seek's own client code consumes. Decoupled from Floppy's envelope. */
export type WatchlistRow = {
	/** TMDB id of the *show* — §12.2: never the episode's id. */
	mediaId: string;
	source: string;
	mediaType: MediaType;
	title: string;
	poster: string | null;
	/** Null when Floppy has no next-up: caught up, or nothing has aired. */
	next: {
		season: number;
		episode: number;
		airDate: string | null;
		/** Absent when Floppy has no episode title; the pill falls back to SxxEyy. */
		title?: string | null;
	} | null;
	progress: number;
	maxProgress: number | null;
	left: number | null;
	/** US subscription services, from TMDB data Floppy already carries. */
	services: string[];
};

/* ── Detail views (§4.4, §6.1) ────────────────────────────────────────────
   Shapes Seek's own components consume, mapped from Floppy in
   $lib/server/detail.ts. Deliberately decoupled: on the show endpoint
   `details.seasons` and `details.episodes` are COUNTS, not arrays — the real
   lists live under `related` (§12.6 in practice). Nothing outside that mapper
   should have to know. */

export type SeasonSummary = {
	seasonNumber: number;
	title: string;
	poster: string | null;
	/** Episodes watched in this season; null when the season isn't tracked. */
	progress: number | null;
	/** Total episodes, when Floppy reports one. */
	maxProgress: number | null;
	tracked: boolean;
};

/**
 * A film. Shares most of ShowDetail's shape, minus everything that only means
 * something for a series: no seasons, and one release date rather than a first
 * and last air date.
 */
export type MovieDetail = {
	mediaId: string;
	source: string;
	title: string;
	/** Public TMDB page — the only link worth sharing outside the house. */
	sourceUrl: string | null;
	poster: string | null;
	synopsis: string | null;
	genres: string[];
	score: number | null;
	scoreCount: number | null;
	/** Always 1 for a movie, but read from Floppy rather than assumed. */
	maxProgress: number | null;
	progress: number;
	tracked: boolean;
	status: string | null;
	releaseDate: string | null;
	studios: string[];
	runtime: number | null;
	certification: string | null;
	cast: { name: string; role: string | null; image: string | null }[];
	/** The franchise this film belongs to, if any — "Toy Story Collection". */
	collection: {
		name: string;
		items: { mediaId: string; source: string; title: string; poster: string | null; year: number | null }[];
	} | null;
};

export type ShowDetail = {
	mediaId: string;
	source: string;
	title: string;
	/** Public TMDB page — the only link worth sharing outside the house. */
	sourceUrl: string | null;
	poster: string | null;
	synopsis: string | null;
	genres: string[];
	score: number | null;
	scoreCount: number | null;
	maxProgress: number | null;
	progress: number;
	tracked: boolean;
	status: string | null;
	firstAirDate: string | null;
	lastAirDate: string | null;
	studios: string[];
	runtime: number | null;
	cast: { name: string; role: string | null; image: string | null }[];
	seasons: SeasonSummary[];
};

export type EpisodeRow = {
	seasonNumber: number;
	episodeNumber: number;
	title: string;
	synopsis: string | null;
	still: string | null;
	runtime: number | null;
	/** Local air datetime with offset, e.g. 2001-10-02T20:00:00-04:00. */
	airDate: string | null;
	/** Number of recorded plays. >0 means watched; >1 means rewatched. */
	plays: number;
};

export type SeasonDetail = {
	mediaId: string;
	source: string;
	seasonNumber: number;
	title: string;
	showTitle: string | null;
	poster: string | null;
	maxProgress: number | null;
	progress: number;
	episodes: EpisodeRow[];
};

/** What the episode sheet renders (§4.4). */
export type EpisodeDetail = EpisodeRow & {
	mediaId: string;
	source: string;
	showTitle: string | null;
};

/* ── Search and add (§6.4) ─────────────────────────────────────────────── */

export type SearchResult = {
	mediaId: string;
	source: string;
	mediaType: MediaType;
	title: string;
	poster: string | null;
	year: number | null;
	/** Whether it is already in the Floppy library. The search endpoint does not
	 *  report this, so it is cross-referenced against the local list. */
	tracked: boolean;
};

/* ── Upcoming (§5) ─────────────────────────────────────────────────────── */

export type UpcomingItem = {
	title: string;
	season: number | null;
	episode: number | null;
	/** UTC instant. */
	start: string;
	/** False when Floppy padded a date with no known time (§5.2). */
	hasTime: boolean;
	poster: string | null;
	/** Present when the title matched something tracked, enabling a link. */
	mediaId: string | null;
	source: string | null;
	/** Films and shows have different detail routes. */
	mediaType: 'tv' | 'movie';
};

/* ── Mood search (§6.2) ────────────────────────────────────────────────── */

export type TmdbResult = {
	mediaId: string;
	source: 'tmdb';
	mediaType: 'tv' | 'movie';
	title: string;
	poster: string | null;
	year: number | null;
	rating: number | null;
	/** Already in the library. Set only where results are marked rather than
	 *  filtered — see markTracked in server/search.ts. */
	tracked?: boolean;
};
