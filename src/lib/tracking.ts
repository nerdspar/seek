/**
 * Shapes and labels for a show's user state, with nothing that touches Floppy.
 *
 * Split out from `$lib/server/tracking` deliberately: that module holds the API
 * client and therefore the credentials, and SvelteKit refuses to bundle it into
 * the browser. The picker needs the labels and bounds, so they live here where
 * both sides can import them.
 */
import { Status } from '$lib/types';

export type Tracking = {
	tracked: boolean;
	/** Floppy's integer status, or null when not tracked. */
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

/** Floppy rejects anything outside this range with a 400. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 10;
