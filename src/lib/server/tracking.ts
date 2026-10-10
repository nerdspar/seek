/**
 * A title's *user* state: where you are with it, and what you thought of it.
 * Kept in Seek's `tracked` table (own-tracking plan).
 */
import { currentUser } from './userctx';
import { setTracked, tmdbIdOf } from './tracking/write';
import { seekTracking } from './tracking/detail';
import { UNTRACKED, type Tracking } from '$lib/tracking';
import type { MediaType } from '$lib/types';

/* Labels, choices and bounds live in $lib/tracking so the picker can import them. */
export { STATUS_CHOICES, SCORE_MAX, SCORE_MIN, UNTRACKED, statusLabel } from '$lib/tracking';
export type { Tracking } from '$lib/tracking';

const kindOf = (mediaType: MediaType) => (mediaType === 'movie' ? 'movie' : 'tv');

/** One title's tracking state. `_title` is kept for callers; Seek looks it up by id. */
export async function getTracking(mediaType: MediaType, source: string, mediaId: string, _title?: string): Promise<Tracking> {
	const me = currentUser();
	const id = tmdbIdOf(source, mediaId);
	if (!me || id === null) return UNTRACKED;
	return seekTracking(me.id, kindOf(mediaType), id);
}

/** Cache key to drop after any write that changes tracking state. */
export const trackingKey = (mediaType: MediaType, source: string, mediaId: string) => `tracking:${mediaType}:${source}:${mediaId}`;

/** Update status and/or score; a null score clears the rating. */
export async function setTracking(mediaType: MediaType, source: string, mediaId: string, change: { status?: number; score?: number | null }): Promise<void> {
	const me = currentUser();
	const id = tmdbIdOf(source, mediaId);
	if (!me || id === null) return;
	setTracked(me.id, kindOf(mediaType), id, change);
}
