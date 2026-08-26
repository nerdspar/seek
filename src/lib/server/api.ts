/** Typed Floppy operations used by Seek. Server-only. */
import { floppy, FloppyError } from './floppy';
import type { CompleteEpisode, FloppyInfo, MediaType, TrackedMedia, WatchlistRow } from '$lib/types';

/** No auth. Cheapest liveness check Floppy offers. */
export const getInfo = () => floppy<FloppyInfo>('/api/v1/info/', { anonymous: true });

/** Authenticated probe — confirms the token, not just that Floppy is up. */
export const whoami = () => floppy<unknown>('/api/v1/user/preferences/');

type ListOpts = {
	status?: (string | number)[];
	progress?: 'all' | 'caught_up' | 'not_caught_up';
	sort?: string;
	direction?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
};

export function listMedia(mediaType: MediaType, opts: ListOpts = {}) {
	return floppy<unknown>(`/api/v1/media/${mediaType}/`, {
		query: {
			status: opts.status,
			progress: opts.progress,
			sort: opts.sort,
			direction: opts.direction,
			limit: opts.limit,
			offset: opts.offset
		}
	});
}

export function getEpisode(source: string, mediaId: string, season: number, episode: number) {
	return floppy<CompleteEpisode>(
		`/api/v1/media/tv/${source}/${encodeURIComponent(mediaId)}/${season}/${episode}/`
	);
}

const ANIME_BUCKET_ERROR = /UNIQUE constraint failed:\s*app_tv\.user_id,\s*app_tv\.item_id/i;

/**
 * Mark a movie watched. Appends one play (§12.3), same as an episode.
 *
 * A separate endpoint because a movie has no season or episode to address, and
 * it is undocumented — absent from openapi.yaml, which lists only the episode
 * watch path. Verified against a live instance: POST returns 201 and creates the
 * tracking entry as well as the play, so a movie that was never tracked can be
 * marked in one call. DELETE returns 204 and pops the newest play.
 */
export function watchMoviePath(source: string, mediaId: string): string {
	return `/api/v1/media/movie/${source}/${encodeURIComponent(mediaId)}/watch/`;
}

export async function markMovieWatched(source: string, mediaId: string): Promise<TrackedMedia> {
	return floppy<TrackedMedia>(watchMoviePath(source, mediaId), { method: 'POST', body: {} });
}

/**
 * Record one play of an episode.
 *
 * §12.2 `mediaId` is the SHOW's TMDB id, never the episode's.
 * §12.3 POST APPENDS — it does not upsert. This function must never retry on
 *       timeout: a timed-out request may well have been written, and retrying
 *       would silently double the play. Only `FloppyUnreachable` (connect-stage
 *       failure, nothing sent) is safe to retry, and even that is left to the
 *       caller rather than done here.
 * §12.1 Anime filed under a separate library bucket surfaces as a UNIQUE
 *       constraint error; that one specific case is retried with an explicit
 *       library_media_type. Safe because the first attempt provably failed.
 *
 * `end_date` is deliberately omitted so Floppy stamps now (§3).
 */
export async function markEpisodeWatched(
	source: string,
	mediaId: string,
	season: number,
	episode: number
): Promise<TrackedMedia> {
	const path =
		`/api/v1/media/tv/${source}/${encodeURIComponent(mediaId)}/${season}/episodes/${episode}/watch/`;

	try {
		return await floppy<TrackedMedia>(path, { method: 'POST', body: {} });
	} catch (err) {
		if (err instanceof FloppyError && ANIME_BUCKET_ERROR.test(err.body)) {
			// The show lives in the Anime library bucket. Nothing was written above.
			return floppy<TrackedMedia>(path, {
				method: 'POST',
				body: { library_media_type: 'anime' }
			});
		}
		throw err;
	}
}
