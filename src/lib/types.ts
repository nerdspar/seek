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
};
