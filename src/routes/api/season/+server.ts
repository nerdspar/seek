import { json, error } from '@sveltejs/kit';
import { floppy, FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import { expire } from '$lib/server/memo';
import { alreadyApplied, markApplied } from '$lib/server/idempotency';
import type { RequestHandler } from './$types';

type Body = { source?: string; mediaId?: string; season?: number; episodes?: number; watched?: number };

/* No real season approaches this. It exists only so a bad `episodes` value
   cannot turn one request into an unbounded run of sequential Floppy writes. */
const MAX_SEASON_STEPS = 1000;

/** Non-negative integer or 0. Guards the loop bound against junk input. */
const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);

function parse(body: Body) {
	const { source = 'tmdb', mediaId, season } = body;
	if (!mediaId || typeof season !== 'number') error(400, 'mediaId and season are required');
	return { source, mediaId, season };
}

const base = (source: string, mediaId: string, season: number) =>
	`/api/v1/media/tv/${source}/${encodeURIComponent(mediaId)}/${season}`;

/**
 * Mark a whole season watched.
 *
 * Floppy has no "set progress to N" — the progress route only accepts
 * increase/decrease — so this steps the season forward one episode at a time.
 * Verified: increasing season progress marks the next individual episode, so the
 * episode list ends up correct rather than just a counter moving.
 *
 * Sequential on purpose (§12.1): these are appends against one show and Floppy
 * resolves the season row per call, which is exactly how duplicate-item errors
 * get provoked.
 */
export const POST: RequestHandler = async ({ request }) => {
	const key = request.headers.get('Idempotency-Key');
	const body = (await request.json()) as Body;
	const { source, mediaId, season } = parse(body);
	// Clamped to a ceiling: `episodes` drives a sequential per-episode Floppy
	// loop, and a crafted value would otherwise mean an unbounded run.
	const total = Math.min(count(body.episodes), MAX_SEASON_STEPS);
	const already = count(body.watched);
	const remaining = Math.max(0, total - already);

	if (!remaining) return json({ ok: true, marked: 0 });

	/* The loop below appends, so a full replay would over-mark. Once a whole
	   season fill has landed under this key, skip a repeat entirely. */
	if (alreadyApplied(key)) return json({ ok: true, marked: 0, replay: true });

	let marked = 0;
	try {
		// The progress route 404s with "Media not found" until the season row
		// exists, and tracking the show alone does not create it — the episode
		// watch endpoint does (§3's resolve_or_create_season). So an untracked
		// season is seeded with one explicit watch, then stepped forward.
		if (already === 0) {
			await floppy(`${base(source, mediaId, season)}/episodes/1/watch/`, {
				method: 'POST',
				body: {},
				timeoutMs: 30_000
			});
			marked++;
		}

		// `increase` advances to the next *unwatched* episode, so a part-watched
		// season is filled in without assuming which episodes are already done.
		for (; marked < remaining; marked++) {
			await floppy(`${base(source, mediaId, season)}/progress/`, {
				method: 'POST',
				body: { operation: 'increase' },
				timeoutMs: 30_000
			});
		}
	} catch (err) {
		expire('watchlist:');
		expire(`show:${source}:${mediaId}`);
		if (err instanceof FloppyUnreachable) error(503, `Floppy unreachable after ${marked} of ${remaining}.`);
		if (err instanceof FloppyError) error(502, `Stopped after ${marked} of ${remaining}: ${err.message}`);
		throw err;
	}

	// Recorded only after the whole fill succeeds — a partial run stays retryable.
	markApplied(key);
	expire('watchlist:');
	expire(`show:${source}:${mediaId}`);
	return json({ ok: true, marked });
};

/**
 * Clear a whole season. Verified: one DELETE on the season path removes every
 * episode's plays, so this does not need to walk the episode list.
 */
export const DELETE: RequestHandler = async ({ request }) => {
	const { source, mediaId, season } = parse(await request.json());
	try {
		await floppy(`${base(source, mediaId, season)}/`, { method: 'DELETE', timeoutMs: 30_000 });
		expire('watchlist:');
		expire(`show:${source}:${mediaId}`);
		return json({ ok: true });
	} catch (err) {
		// An untracked season has nothing to clear, which is the desired end state
		// anyway — treat it as success rather than surfacing an error.
		if (err instanceof FloppyError && err.status === 404) {
			expire('watchlist:');
			expire(`show:${source}:${mediaId}`);
			return json({ ok: true, alreadyClear: true });
		}
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable; nothing was cleared.');
		if (err instanceof FloppyError) error(502, err.message);
		throw err;
	}
};
