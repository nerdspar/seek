/** Shapes shared by Seek's server and its pages. */

export type MediaType = 'tv' | 'movie' | 'anime';

/** A title's status, as stored. */
export const Status = {
	Planning: 0,
	InProgress: 1,
	Paused: 2,
	Completed: 3,
	Dropped: 4
} as const;

/** One watchlist row. */
export type WatchlistRow = {
	/** TMDB id of the *show* — §12.2: never the episode's id. */
	mediaId: string;
	source: string;
	mediaType: MediaType;
	title: string;
	poster: string | null;
	/** Null when there is no next-up: caught up, or nothing has aired. */
	next: {
		season: number;
		episode: number;
		airDate: string | null;
		/** Absent when the episode has no title; the pill falls back to SxxEyy. */
		title?: string | null;
	} | null;
	progress: number;
	maxProgress: number | null;
	left: number | null;
	/** US subscription services, from Seek's TMDB copy. */
	services: string[];
};

/* ── Detail views (§4.4, §6.1) ────────────────────────────────────────────
   Shapes Seek's own components consume, built from Seek's plays and TMDB
   copy in $lib/server/tracking/detail.ts. */

export type SeasonSummary = {
	seasonNumber: number;
	title: string;
	poster: string | null;
	/** Episodes watched in this season; null when the season isn't tracked. */
	progress: number | null;
	/** Total episodes, when known. */
	maxProgress: number | null;
	/** Episodes that have actually aired (≤ maxProgress) — what a whole-season
	 *  mark stops at, so a currently-airing season isn't ticked past what's out.
	 *  Equals maxProgress for an ended show; null when maxProgress is unknown. */
	airedMax: number | null;
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
	/** Always 1 for a movie. */
	maxProgress: number | null;
	progress: number;
	/** Whether a play is on record. */
	watched: boolean;
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
	/** Whether it is already on your list. TMDB's search does not report this,
	 *  so it is cross-referenced against Seek's `tracked` table. */
	tracked: boolean;
};

/* ── Upcoming (§5) ─────────────────────────────────────────────────────── */

export type UpcomingItem = {
	title: string;
	season: number | null;
	episode: number | null;
	/** UTC instant. */
	start: string;
	/** False when only the date is known (§5.2). */
	hasTime: boolean;
	poster: string | null;
	/** Present when the title matched something tracked, enabling a link. */
	mediaId: string | null;
	source: string | null;
	/** Films and shows have different detail routes. */
	mediaType: 'tv' | 'movie';
	/** What it is, for the filter: an episode, a film, or a book. Absent on
	 *  calendar rows = episode (or film, per mediaType). */
	kind?: 'episode' | 'movie' | 'book';
	/** A short line under the title: "In theaters", "On your list"… */
	note?: string | null;
	/** Books: open their sheet. */
	hardcoverId?: number | null;
	author?: string | null;
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
