import { json, error } from '@sveltejs/kit';
import { markEpisodeWatched, markMovieWatched, watchMoviePath } from '$lib/server/api';
import { getRow } from '$lib/server/watchlist';
import { setTracking } from '$lib/server/tracking';
import { floppy, FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import { patch, expire, invalidate } from '$lib/server/memo';
import { alreadyApplied, markApplied } from '$lib/server/idempotency';
import type { WatchlistPage } from '$lib/server/watchlist';
import { Status } from '$lib/types';
import type { WatchlistRow } from '$lib/types';
import type { MediaType } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * A show completes automatically when its last unwatched episode is marked, but
 * nothing ever walked that back. Unmark an episode of a Completed show and it
 * stayed Completed with a gap in it — dropped from the in-progress watchlist,
 * and (until the Discover fix) hard to navigate back to at all.
 *
 * So on unmark: if the episode now has no plays, the show is no longer complete,
 * and if it was Completed it returns to In progress. Gated on zero plays so
 * removing one play of a rewatch (still watched) does not flip it, and only from
 * Completed — a Dropped or Paused show was set that way deliberately. Best
 * effort throughout: the play was already removed, and the walk-back must never
 * turn a successful unmark into a reported failure.
 */
/**
 * Fold a freshly-read row back into the cached watchlist without a rebuild.
 *
 * In the in-progress backlog (`status=in_progress`, which alone carries the
 * `not_caught_up` filter) a row that is now caught up — no next episode —
 * is *removed*, not updated in place. Marking a show's last episode used to
 * leave it sitting in the list, because the patch swapped in the completed row
 * and the stale-while-revalidate read served exactly that until a manual
 * refresh. Everywhere else (All, Completed) the row is updated in place.
 */
function applyRowToWatchlist(row: WatchlistPage['rows'][number], source: string, mediaId: string) {
	const isRow = (r: WatchlistRow) => r.source === source && r.mediaId === mediaId;
	patch<WatchlistPage>('watchlist:', (page, key) => {
		const isBacklog = key.split(':')[3] === 'in_progress';
		if (isBacklog && row.next === null) {
			return { ...page, rows: page.rows.filter((r) => !isRow(r)) };
		}
		return { ...page, rows: page.rows.map((r) => (isRow(r) ? row : r)) };
	});
}

async function revertCompletionIfNeeded(
	source: string,
	mediaId: string,
	season: number,
	episode: number
): Promise<boolean> {
	try {
		const enc = encodeURIComponent(mediaId);
		const [ep, show] = await Promise.all([
			// An episode's top-level `progress` is always null; its play count is
			// `consumptions_number`. Reading `progress` made this 0 every time, so
			// the rewatch guard below never held.
			floppy<{ consumptions_number?: number | null }>(`/api/v1/media/tv/${source}/${enc}/${season}/${episode}/`),
			floppy<{ consumptions?: { status?: number | null }[] }>(`/api/v1/media/tv/${source}/${enc}/`)
		]);
		const plays = typeof ep?.consumptions_number === 'number' ? ep.consumptions_number : 0;
		const status = show?.consumptions?.[0]?.status ?? null;
		if (plays === 0 && status === Status.Completed) {
			await setTracking('tv', source, mediaId, { status: Status.InProgress });
			return true;
		}
	} catch {
		/* Leave the status as it is rather than fail the unmark over it. */
	}
	return false;
}

type Body = {
	source?: string;
	mediaId?: string;
	mediaType?: MediaType;
	title?: string;
	season?: number;
	episode?: number;
};

function parse(body: Body) {
	const { source = 'tmdb', mediaId, season, episode, mediaType = 'tv', title = '' } = body;
	if (!mediaId) error(400, 'mediaId is required');

	/* A movie has nothing to address below itself, so it carries no season or
	   episode and must not be held to them. Everything else does. */
	const isMovie = mediaType === 'movie';
	if (!isMovie && (typeof season !== 'number' || typeof episode !== 'number')) {
		// §12.2: mediaId is the SHOW's TMDB id. The client only ever sends what
		// came back on the row, so there is no place for an episode id to sneak in.
		error(400, 'mediaId, season and episode are required');
	}
	return { source, mediaId, season, episode, mediaType, title, isMovie };
}

/** Mark watched. Appends one play (§12.3). */
export const POST: RequestHandler = async ({ request }) => {
	const key = request.headers.get('Idempotency-Key');
	const { source, mediaId, season, episode, mediaType, title, isMovie } = parse(
		await request.json()
	);

	/* A POST appends, so a replayed request (the queue retrying one whose response
	   was lost) would record a second play. Skip the write when this key's play
	   has already landed; the refresh below still returns the current row. */
	const replay = alreadyApplied(key);
	try {
		if (!replay) {
			if (isMovie) await markMovieWatched(source, mediaId);
			else await markEpisodeWatched(source, mediaId, season as number, episode as number);
			markApplied(key);
		}
	} catch (err) {
		if (err instanceof FloppyUnreachable) {
			// Nothing was written — safe for the client to offer a retry.
			error(503, 'Floppy unreachable; nothing was recorded.');
		}
		if (err instanceof FloppyError) error(err.status === 404 ? 404 : 502, err.message);
		throw err;
	}

	/* The write succeeded. Re-read this one show for its new next-up (§4.2).
	   Deliberately outside the try above: a refresh failure must not be reported
	   as a failed mark, or the client would roll back a play that was recorded. */
	try {
		const row = await getRow(mediaType, source, mediaId, title);

		/* Update the cached list in place rather than dropping it.
		   Discarding the cache here was what made marking expensive: the next
		   watchlist view had to rebuild from scratch — a 2.3s list query plus an
		   88-way title fan-out — so a couple of quick marks left the app looking
		   hung. Here the one row that changed is swapped in and everything else
		   stays warm. */
		if (row) applyRowToWatchlist(row, source, mediaId);
		// Still mark it stale so a background refresh reconciles anything the
		// patch could not know about, like a show dropping out of the filter.
		expire('watchlist:');
		// The show page shows season progress, which this just changed. A film's
		// page reads its watched state straight off the cached progress, so that
		// one is dropped rather than marked stale — serving it stale would show
		// the state the tap just reversed.
		if (isMovie) invalidate(`movie:${source}:${mediaId}`);
		else {
			expire(`show:${source}:${mediaId}`);
			/* The season page caches its episode list for five minutes and was
			   the one thing no write ever dropped, so leaving the page and
			   coming back showed the episodes unmarked again. Dropped rather
			   than expired: a checkbox is the definition of actively wrong. */
			invalidate(`season:${source}:${mediaId}:${season}`);
		}

		return json({ ok: true, row });
	} catch {
		expire('watchlist:');
		if (isMovie) invalidate(`movie:${source}:${mediaId}`);
		else {
			expire(`show:${source}:${mediaId}`);
			invalidate(`season:${source}:${mediaId}:${season}`);
		}
		return json({ ok: true, row: null, stale: true });
	}
};

/**
 * Undo (§4.3). Removes the most recent play for this episode.
 *
 * Verified live on v26.8.20: DELETE on the watch path returns 204 and pops
 * exactly the newest consumption row, leaving older plays intact. It is absent
 * from openapi.yaml — the contract under-documents it — so if undo ever starts
 * 405ing after a Floppy update, that is the first thing to re-check.
 *
 * Do NOT substitute DELETE on the episode detail path here: that one is
 * documented as deleting the tracked episode item, and on a rewatched episode
 * it would take more than the single play this is meant to reverse.
 */
export const DELETE: RequestHandler = async ({ request }) => {
	const key = request.headers.get('Idempotency-Key');
	const { source, mediaId, season, episode, mediaType, title, isMovie } = parse(
		await request.json()
	);
	const path = isMovie
		? watchMoviePath(source, mediaId)
		: `/api/v1/media/tv/${source}/${encodeURIComponent(mediaId)}/${season}/episodes/${episode}/watch/`;

	/* DELETE pops the newest play, so a replay would remove a second one. Skip it
	   when this key's removal has already landed. */
	const replay = alreadyApplied(key);
	try {
		if (!replay) {
			await floppy(path, { method: 'DELETE' });
			markApplied(key);
		}
	} catch (err) {
		if (err instanceof FloppyError && err.status === 405) {
			error(502, 'Floppy no longer accepts DELETE on the watch path; undo is unavailable.');
		}
		if (err instanceof FloppyError) error(502, err.message);
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable; the play was not removed.');
		throw err;
	}

	// Un-completing a show it just completed. Episodes only; a film's status is
	// managed from its own page.
	const reverted = isMovie
		? false
		: await revertCompletionIfNeeded(source, mediaId, season as number, episode as number);

	try {
		const row = await getRow(mediaType, source, mediaId, title);
		if (row) applyRowToWatchlist(row, source, mediaId);
		/* A revert put the show back into the in-progress backlog, but a patch
		   cannot re-insert a row the cached list dropped when it completed. Drop
		   those entries so the next read rebuilds with the show present, rather
		   than serving a stale list that still omits it. */
		if (reverted) invalidate('watchlist:');
		else expire('watchlist:');
		if (isMovie) invalidate(`movie:${source}:${mediaId}`);
		else {
			expire(`show:${source}:${mediaId}`);
			invalidate(`season:${source}:${mediaId}:${season}`);
		}
		return json({ ok: true, row });
	} catch {
		expire('watchlist:');
		if (isMovie) invalidate(`movie:${source}:${mediaId}`);
		else {
			expire(`show:${source}:${mediaId}`);
			invalidate(`season:${source}:${mediaId}:${season}`);
		}
		return json({ ok: true, row: null, stale: true });
	}
};
