/**
 * The copy out of Floppy (own-tracking plan, step 2): the pure half — Floppy
 * list rows into tracked titles, Floppy history rows into plays. Seek keys
 * everything on TMDB; anything Floppy holds under another source is set aside
 * for review instead of guessed at.
 */

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});

export type MediaType = 'tv' | 'movie';

export type TrackedRow = {
	mediaType: MediaType;
	tmdbId: number;
	/** Floppy's codes, kept: 0 Planning, 1 Watching, 2 Paused, 3 Completed, 4 Dropped. */
	status: number;
	score: number | null;
	notes: string;
	addedAt: string;
	updatedAt: string;
};

export type PlayRow = {
	mediaType: MediaType;
	tmdbId: number;
	/** Null for a film. */
	season: number | null;
	episode: number | null;
	watchedAt: string;
	externalKey: string;
};

/** Something the copy couldn't take as-is. */
export type Review = { mediaType: string; ref: string; reason: string; detail: string };

const tmdbIdOf = (source: unknown, mediaId: unknown): number | null => {
	const id = Number(mediaId);
	return source === 'tmdb' && Number.isInteger(id) && id > 0 ? id : null;
};
const isoOf = (v: unknown): string | null => {
	const ms = Date.parse(String(v ?? ''));
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/** One Floppy list row (`/media/{tv|movie}/`) → a tracked title, or a review note. */
export function trackedFromList(mediaType: MediaType, raw: unknown): TrackedRow | Review {
	const r = rec(raw);
	const item = rec(r.item);
	const tmdbId = tmdbIdOf(item.source, item.media_id);
	if (tmdbId === null) {
		return { mediaType, ref: `${item.source}:${item.media_id}`, reason: 'not-tmdb', detail: String(item.title ?? '') };
	}
	const status = typeof r.status === 'number' && r.status >= 0 && r.status <= 4 ? r.status : 0;
	const added = isoOf(r.created_at) ?? new Date(0).toISOString();
	return {
		mediaType,
		tmdbId,
		status,
		score: typeof r.score === 'number' ? r.score : null,
		notes: typeof r.notes === 'string' ? r.notes : '',
		addedAt: added,
		updatedAt: isoOf(r.progressed_at) ?? added
	};
}

/** One Floppy history row (`/history/?flat=1`) → a play, a review note, or
 *  null for something that isn't an episode or a film. */
export function playFromHistory(raw: unknown): PlayRow | Review | null {
	const r = rec(raw);
	const item = rec(r.item);
	const movie = r.media_type === 'movie';
	if (r.media_type !== 'episode' && !movie) return null;
	const mediaType: MediaType = movie ? 'movie' : 'tv';
	const at = isoOf(r.played_at_local);
	const season = movie ? null : Number(r.season_number ?? item.season_number);
	const episode = movie ? null : Number(r.episode_number ?? item.episode_number);
	const ref = `${item.source}:${item.media_id}${movie ? '' : `:S${season}E${episode}`}`;
	const tmdbId = tmdbIdOf(item.source, item.media_id);
	if (tmdbId === null) return { mediaType, ref, reason: 'not-tmdb', detail: String(r.title ?? item.title ?? '') };
	if (!at) return { mediaType, ref, reason: 'no-date', detail: String(r.title ?? '') };
	if (!movie && (!Number.isInteger(season) || !Number.isInteger(episode))) {
		return { mediaType, ref, reason: 'no-episode', detail: String(r.title ?? '') };
	}
	const instance = Number(r.instance_id);
	// Floppy's play id makes a re-run skip what's copied; without one, the play's own coordinates do.
	const externalKey =
		Number.isInteger(instance) && instance > 0
			? `floppy:${r.media_type}:${instance}`
			: `floppy:${mediaType}:${tmdbId}:${season ?? ''}:${episode ?? ''}:${at}`;
	return { mediaType, tmdbId, season, episode, watchedAt: at, externalKey };
}

export const isReview = (x: unknown): x is Review => Boolean(x) && typeof x === 'object' && 'reason' in (x as object);
