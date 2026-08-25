import { json, error } from '@sveltejs/kit';
import { markEpisodeWatched } from '$lib/server/api';
import { getRow } from '$lib/server/watchlist';
import { floppy, FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import { patch, expire } from '$lib/server/memo';
import type { WatchlistPage } from '$lib/server/watchlist';
import type { WatchlistRow } from '$lib/types';
import type { MediaType } from '$lib/types';
import type { RequestHandler } from './$types';

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
	// §12.2: mediaId is the SHOW's TMDB id. The client only ever sends what came
	// back on the row, so there is no place for an episode id to sneak in.
	if (!mediaId || typeof season !== 'number' || typeof episode !== 'number') {
		error(400, 'mediaId, season and episode are required');
	}
	return { source, mediaId, season, episode, mediaType, title };
}

/** Mark watched. Appends one play (§12.3). */
export const POST: RequestHandler = async ({ request }) => {
	const { source, mediaId, season, episode, mediaType, title } = parse(await request.json());

	try {
		await markEpisodeWatched(source, mediaId, season, episode);
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
		if (row) patch<WatchlistPage>('watchlist:', (page) => ({
			...page,
			rows: page.rows.map((r: WatchlistRow) =>
				r.source === source && r.mediaId === mediaId ? row : r
			)
		}));
		// Still mark it stale so a background refresh reconciles anything the
		// patch could not know about, like a show dropping out of the filter.
		expire('watchlist:');

		return json({ ok: true, row });
	} catch {
		expire('watchlist:');
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
	const { source, mediaId, season, episode, mediaType, title } = parse(await request.json());
	const path =
		`/api/v1/media/tv/${source}/${encodeURIComponent(mediaId)}/${season}/episodes/${episode}/watch/`;

	try {
		await floppy(path, { method: 'DELETE' });
	} catch (err) {
		if (err instanceof FloppyError && err.status === 405) {
			error(502, 'Floppy no longer accepts DELETE on the watch path; undo is unavailable.');
		}
		if (err instanceof FloppyError) error(502, err.message);
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable; the play was not removed.');
		throw err;
	}

	try {
		const row = await getRow(mediaType, source, mediaId, title);
		if (row) patch<WatchlistPage>('watchlist:', (page) => ({
			...page,
			rows: page.rows.map((r: WatchlistRow) =>
				r.source === source && r.mediaId === mediaId ? row : r
			)
		}));
		expire('watchlist:');
		return json({ ok: true, row });
	} catch {
		expire('watchlist:');
		return json({ ok: true, row: null, stale: true });
	}
};
