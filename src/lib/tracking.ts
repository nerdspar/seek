/**
 * Shapes and labels for a title's user state, safe for the browser. Split out
 * from `$lib/server/tracking`, which reads the database and can't be bundled
 * into the client; the picker needs the labels and bounds, so they live here.
 */
import { Status } from '$lib/types';

export type Tracking = {
	tracked: boolean;
	/** The status code (0 Planning … 4 Dropped), or null when not tracked. */
	status: number | null;
	/** The user's own 0–10 rating, not the community score. */
	score: number | null;
};

export const UNTRACKED: Tracking = { tracked: false, status: null, score: null };

/** Every status, in the order a picker should list them. */
export const STATUS_CHOICES = [
	{ value: Status.InProgress, label: 'Watching' },
	{ value: Status.Planning, label: 'Plan to watch' },
	{ value: Status.Paused, label: 'Paused' },
	{ value: Status.Completed, label: 'Completed' },
	{ value: Status.Dropped, label: 'Dropped' }
] as const;

export function statusLabel(status: number | null): string | null {
	return STATUS_CHOICES.find((c) => c.value === status)?.label ?? null;
}

/** Ratings are 0–10. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 10;
