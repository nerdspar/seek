/**
 * Keeps Seek's copy of show and movie info fresh (docs/own-tracking-plan.md,
 * step 1). Every title anyone tracks is known; each refresh fetches TMDB details,
 * the seasons that may have changed, and — for shows still airing — TVmaze's air
 * times. Nothing reads this yet; step 3 switches the screens over.
 */
import { applyAirTimes, mapMovie, mapSeason, mapShow, refreshAfter, seasonsToFetch, type EpisodeRow, type MediaType } from './map';
import { dueTitles, ensureTitle, noteFailure, saveTitle, storedSeasonCounts, storedTvmazeId } from './store';
import { tmdbMovie, tmdbSeason, tmdbShow, tvmazeEpisodes, tvmazeId } from './sources';
import { getWatchlist } from '../watchlist';

const HOUR = 60 * 60 * 1000;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Refresh one title now. */
export async function refreshTitle(mediaType: MediaType, tmdbId: number, gapMs = 250, now = () => Date.now()): Promise<void> {
	try {
		if (mediaType === 'movie') {
			const t = mapMovie(tmdbId, await tmdbMovie(tmdbId));
			saveTitle(t, new Map(), null, now(), refreshAfter(t, now()));
			return;
		}
		const { title, seasons, lastAiredSeason } = mapShow(tmdbId, await tmdbShow(tmdbId));
		const fetched = new Map<number, EpisodeRow[]>();
		for (const n of seasonsToFetch(storedSeasonCounts(tmdbId), seasons, lastAiredSeason)) {
			if (gapMs) await pause(gapMs);
			fetched.set(n, mapSeason(tmdbId, n, await tmdbSeason(tmdbId, n)));
		}
		// Air times matter only for what's still to air (and next-up around it).
		let mazeId = storedTvmazeId(tmdbId);
		const live = title.status !== 'Ended' && title.status !== 'Canceled';
		if (live && fetched.size) {
			try {
				mazeId ??= await tvmazeId(title.tvdbId, title.imdbId);
				if (mazeId) {
					const maze = await tvmazeEpisodes(mazeId);
					for (const [n, rows] of fetched) fetched.set(n, applyAirTimes(rows, maze));
				}
			} catch (err) {
				// Times are a nicety; the dates still stand.
				console.warn(`[catalog] TVmaze times for TMDB ${tmdbId} failed:`, err);
			}
		}
		saveTitle(title, fetched, mazeId, now(), refreshAfter(title, now()));
	} catch (err) {
		noteFailure(mediaType, tmdbId, err instanceof Error ? err.message : String(err), now() + HOUR);
		throw err;
	}
}

/** Refresh whatever's due, oldest first, a batch at a time. */
export async function refreshDue(limit = 80, gapMs = 250): Promise<{ refreshed: number; failed: number }> {
	const out = { refreshed: 0, failed: 0 };
	for (const t of dueTitles(Date.now(), limit)) {
		try {
			await refreshTitle(t.mediaType, t.tmdbId, gapMs);
			out.refreshed++;
		} catch {
			out.failed++;
		}
		if (gapMs) await pause(gapMs);
	}
	return out;
}

/**
 * Add the titles this person tracks (read from Floppy until step 4). Run for each
 * person by the scheduler; only TMDB-sourced items, since Seek keys on TMDB.
 */
export async function seedTrackedTitles(): Promise<number> {
	let added = 0;
	for (const mediaType of ['tv', 'movie'] as const) {
		const page = await getWatchlist(mediaType, { statuses: ['all'], sort: 'title', direction: 'asc', all: true, enrich: false });
		for (const row of page.rows) {
			const id = Number(row.mediaId);
			if (row.source !== 'tmdb' || !Number.isInteger(id) || id <= 0) continue;
			if (ensureTitle(mediaType, id)) added++;
		}
	}
	return added;
}
