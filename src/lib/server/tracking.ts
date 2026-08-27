/**
 * A show's *user* state: where you are with it, and what you thought of it.
 *
 * Two things about Floppy make this its own module rather than a field on the
 * detail response.
 *
 * **Detail does not carry it.** `GET /api/v1/media/tv/{source}/{id}/` reports
 * `tracked`, but its `status` is always null and its `score` is the community
 * rating — 8.1 for Reacher whether or not you have ever seen it. Your status
 * and your score live only on the *list* row, and the list has no id filter, so
 * reading one item means searching by title and matching on media_id. That is
 * the same shape as watchlist.getRow and the same reason.
 *
 * **Reads and writes use different vocabularies.** The list filter takes
 * `in_progress`; PATCH rejects it with 400 and wants `in progress`. Verified
 * against a live instance:
 *
 *     PATCH {"status": "in_progress"}   -> 400 Invalid status value
 *     PATCH {"status": "in progress"}   -> 200, becomes 1
 *     PATCH {"status": 1}               -> 200, becomes 1
 *
 * So writes send integers, which are unambiguous and work for all five states.
 * Never send the filter spelling.
 */
import { floppy } from './floppy';
import { memo } from './memo';
import { UNTRACKED, type Tracking } from '$lib/tracking';
import type { MediaType } from '$lib/types';

/* Labels, choices and bounds live in $lib/tracking so the picker can import
   them — this module holds the API client and cannot reach the browser. */
export { STATUS_CHOICES, SCORE_MAX, SCORE_MIN, UNTRACKED, statusLabel } from '$lib/tracking';
export type { Tracking } from '$lib/tracking';

type ListResponse = { results?: { item?: Record<string, unknown> }[] };

const key = (mediaType: MediaType, source: string, mediaId: string) =>
	`tracking:${mediaType}:${source}:${mediaId}`;

/**
 * Read one item's tracking state.
 *
 * Cached briefly and invalidated on every write, because a stale answer here is
 * the difference between "Watching" and "Dropped" on screen.
 */
export function getTracking(
	mediaType: MediaType,
	source: string,
	mediaId: string,
	title: string
): Promise<Tracking> {
	return memo(key(mediaType, source, mediaId), 60 * 1000, async () => {
		if (!title) return UNTRACKED;
		try {
			const res = await floppy<ListResponse>(`/api/v1/media/${mediaType}/`, {
				// `progress: 'all'` or a finished show drops out of the default query
				// and reads as untracked.
				query: { status: ['all'], progress: 'all', search: title, limit: 50 }
			});
			/* Matched on media_id, never the first hit: a title search is fuzzy and
			   "Below Deck" returns three different shows. */
			const hit = (res.results ?? []).find(
				(r) =>
					String(r.item?.media_id ?? '') === String(mediaId) &&
					String(r.item?.source ?? '') === source
			) as (Record<string, unknown> & { item?: Record<string, unknown> }) | undefined;
			if (!hit) return UNTRACKED;

			const item = (hit.item ?? {}) as Record<string, unknown>;
			return {
				tracked: true,
				status: typeof hit.status === 'number' ? hit.status : null,
				score: typeof hit.score === 'number' ? hit.score : null,
				floppyPath: typeof item.url === 'string' ? item.url : null
			};
		} catch {
			// A failed read must not make a tracked show look untracked and offer to
			// add it again; say nothing rather than something wrong.
			return UNTRACKED;
		}
	});
}

/** Cache key to drop after any write that changes tracking state. */
export const trackingKey = key;

/**
 * Update status and/or score.
 *
 * Sends integers for status — see the note at the top of this file. A null
 * score clears the rating, which Floppy accepts.
 */
export async function setTracking(
	mediaType: MediaType,
	source: string,
	mediaId: string,
	change: { status?: number; score?: number | null }
): Promise<void> {
	const body: Record<string, unknown> = {};
	if (change.status !== undefined) body.status = change.status;
	if (change.score !== undefined) body.score = change.score;
	if (!Object.keys(body).length) return;

	await floppy(`/api/v1/media/${mediaType}/${source}/${encodeURIComponent(mediaId)}/`, {
		method: 'PATCH',
		body
	});
}
