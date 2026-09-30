/**
 * Anime classification sync.
 *
 * Jellyfin's "Anime" library is the source of truth for what's anime; Floppy is
 * where it's stored. This job reads the library (via jellyfin.ts) and reconciles
 * a Floppy `anime` tag to match: tag the tracked TV shows that are in the Anime
 * library, untag the ones that no longer are. The Shows/Anime split then reads
 * straight off that tag (`getWatchlist('tv', { tag })`), so a page load never
 * touches Jellyfin.
 *
 * Runs on a schedule and on demand. Idempotent — only the diff is written.
 */
import { getWatchlist } from './watchlist';
import { fetchAnimeTmdbIds, jellyfinConfigured } from './jellyfin';
import { ANIME_TAG, setItemTag } from './tags';
import { expire } from './memo';
import type { WatchlistRow } from '$lib/types';

/**
 * Decide which shows to tag / untag. Pure and total:
 *  - add: tracked shows that ARE anime but aren't tagged yet
 *  - remove: tagged shows that are no longer in the Anime library
 * Anime ids that aren't tracked in Floppy are ignored — there's no row to tag.
 */
export function reconcileAnimeTags(
	animeTmdb: Set<string>,
	trackedTmdb: Set<string>,
	taggedTmdb: Set<string>
): { add: string[]; remove: string[] } {
	const add: string[] = [];
	for (const id of trackedTmdb) {
		if (animeTmdb.has(id) && !taggedTmdb.has(id)) add.push(id);
	}
	const remove: string[] = [];
	for (const id of taggedTmdb) {
		if (!animeTmdb.has(id)) remove.push(id);
	}
	return { add, remove };
}

/** TMDB ids of the rows sourced from TMDB (the only source the anime set keys on). */
function tmdbIdsOf(rows: WatchlistRow[]): Set<string> {
	const set = new Set<string>();
	for (const r of rows) {
		if (r.source === 'tmdb') set.add(r.mediaId);
	}
	return set;
}

export type AnimeSyncResult = {
	added: number;
	removed: number;
	animeInJellyfin: number;
	skipped?: string;
};

/** Reconcile the Floppy `anime` tag to Jellyfin's Anime library. No-op (and no
 *  writes) when Jellyfin isn't configured. */
export async function syncAnimeTags(): Promise<AnimeSyncResult> {
	if (!jellyfinConfigured()) {
		return { added: 0, removed: 0, animeInJellyfin: 0, skipped: 'jellyfin-not-configured' };
	}

	// Throws if Jellyfin is unreachable — the caller logs it and leaves existing
	// tags alone rather than wiping them on a transient outage.
	const animeTmdb = await fetchAnimeTmdbIds();

	const [tracked, tagged] = await Promise.all([
		getWatchlist('tv', { statuses: ['all'], all: true, enrich: false }),
		getWatchlist('tv', { statuses: ['all'], all: true, enrich: false, tag: ANIME_TAG })
	]);

	const { add, remove } = reconcileAnimeTags(
		animeTmdb,
		tmdbIdsOf(tracked.rows),
		tmdbIdsOf(tagged.rows)
	);

	// Sequential: keeps well under Floppy's limits, and the diff is small after
	// the first run. expireWatchlist is deferred to one sweep at the end.
	for (const id of add) {
		await setItemTag('tv', 'tmdb', id, ANIME_TAG, true, { expireWatchlist: false });
	}
	for (const id of remove) {
		await setItemTag('tv', 'tmdb', id, ANIME_TAG, false, { expireWatchlist: false });
	}

	if (add.length || remove.length) {
		expire('watchlist:');
		expire('library:');
		expire('collection:');
	}

	return { added: add.length, removed: remove.length, animeInJellyfin: animeTmdb.size };
}
