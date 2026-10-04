/**
 * What's anime, and the Floppy `anime` tag that records it.
 *
 * Floppy's own metadata decides: a show is anime when its genres include
 * "Anime". That follows the show wherever you watch it (Netflix, Crunchyroll,
 * Jellyfin), which a Jellyfin library never could — anime streamed elsewhere
 * was missed, and western animation filed in the Anime folder was counted.
 * Compared across a real 406-show library, Floppy's genre matched TMDB and
 * TVDB on 40 of its 42 anime; where it's a judgment call (a Chinese donghua,
 * an American show in anime style) the household overrules it per show.
 *
 * Each person's Floppy carries its own tag. This job reconciles it to the
 * verdicts — on a schedule, for everyone, and for one show right after it's
 * added. The Shows/Anime split then reads straight off the tag
 * (`getWatchlist('tv', { tag })`).
 *
 * Idempotent: only the diff is written. A show Floppy has no genres for yet
 * keeps whatever tag it has.
 */
import { getWatchlist } from './watchlist';
import { floppy } from './floppy';
import { ANIME_TAG, getItemTags, setItemTag } from './tags';
import { expire } from './memo';
import { db, nowIso } from './db';
import { currentUser } from './userctx';
import type { WatchlistRow } from '$lib/types';

/** Anime per Floppy's genres (its own and implied); null when it has none yet
 *  (metadata not fetched), which means "can't say", not "not anime". */
export function animeByGenres(genres: unknown, implied: unknown = []): boolean | null {
	const all = [...(Array.isArray(genres) ? genres : []), ...(Array.isArray(implied) ? implied : [])].filter(
		(g): g is string => typeof g === 'string'
	);
	if (!all.length) return null;
	return all.some((g) => g.toLowerCase() === 'anime');
}

/**
 * Decide which shows to tag / untag. Pure and total:
 *  - add: tracked shows that ARE anime but aren't tagged yet
 *  - remove: tagged shows that are not anime
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

/* ── Overrides ───────────────────────────────────────────────────────────── */

/** The household's own answers, where it disagrees with TMDB. */
export function animeOverrides(householdId: number): Map<string, boolean> {
	const rows = db()
		.prepare('SELECT media_id, is_anime FROM anime_overrides WHERE household_id = ? AND source = ?')
		.all(householdId, 'tmdb') as { media_id: string; is_anime: number }[];
	return new Map(rows.map((r) => [r.media_id, r.is_anime === 1]));
}

/** Overrule TMDB for one show (null: go back to TMDB's answer). */
export function setAnimeOverride(householdId: number, userId: number, tmdbId: string, isAnime: boolean | null): void {
	if (isAnime === null) {
		db()
			.prepare('DELETE FROM anime_overrides WHERE household_id = ? AND source = ? AND media_id = ?')
			.run(householdId, 'tmdb', tmdbId);
		return;
	}
	db()
		.prepare(
			`INSERT INTO anime_overrides (household_id, source, media_id, is_anime, user_id, created_at)
			 VALUES (?, 'tmdb', ?, ?, ?, ?)
			 ON CONFLICT (household_id, source, media_id) DO UPDATE SET is_anime = excluded.is_anime, user_id = excluded.user_id`
		)
		.run(householdId, tmdbId, isAnime ? 1 : 0, userId, nowIso());
}

/* ── Verdicts ────────────────────────────────────────────────────────────── */

/** The household's override where there is one, else Floppy's genre. */
export function verdict(id: string, byGenre: boolean | null, overrides: Map<string, boolean>): boolean | null {
	return overrides.has(id) ? overrides.get(id)! : byGenre;
}

type Raw = Record<string, unknown>;

/** Every tracked TV show's anime-by-genre, from Floppy's library list (the
 *  genres ride along on each row's item). Keyed by TMDB id. */
async function libraryGenres(): Promise<Map<string, boolean | null>> {
	const out = new Map<string, boolean | null>();
	for (let offset = 0; offset < 20_000; ) {
		const page = await floppy<{ results?: Raw[]; pagination?: { total?: number } }>('/api/v1/media/tv/', {
			query: { limit: 100, offset }
		});
		const results = page.results ?? [];
		for (const r of results) {
			const item = (r.item ?? {}) as Raw;
			if (item.source === 'tmdb' && typeof item.media_id === 'string') {
				out.set(item.media_id, animeByGenres(item.genres, item.implied_genres));
			}
		}
		offset += results.length;
		if (!results.length || offset >= (page.pagination?.total ?? 0)) break;
	}
	return out;
}

/** TMDB ids of the rows sourced from TMDB (the only source verdicts key on). */
function tmdbIdsOf(rows: WatchlistRow[]): Set<string> {
	const set = new Set<string>();
	for (const r of rows) {
		if (r.source === 'tmdb') set.add(r.mediaId);
	}
	return set;
}

export type AnimeSyncResult = { added: number; removed: number; anime: number; skipped?: string };

function expireLists(): void {
	expire('watchlist:');
	expire('library:');
	expire('collection:');
}

/** Reconcile this person's `anime` tags to the verdicts. */
export async function syncAnimeTags(): Promise<AnimeSyncResult> {
	const me = currentUser();
	const overrides = me ? animeOverrides(me.householdId) : new Map<string, boolean>();

	const [genres, tagged] = await Promise.all([
		libraryGenres(),
		getWatchlist('tv', { statuses: ['all'], all: true, enrich: false, tag: ANIME_TAG })
	]);
	const trackedIds = new Set(genres.keys());
	const taggedIds = tmdbIdsOf(tagged.rows);

	// Anime: what the verdicts say — and, where they can't say, what's tagged now.
	const anime = new Set<string>();
	for (const id of trackedIds) {
		const v = verdict(id, genres.get(id) ?? null, overrides);
		if (v === true || (v === null && taggedIds.has(id))) anime.add(id);
	}
	const { add, remove } = reconcileAnimeTags(anime, trackedIds, taggedIds);

	// Sequential: keeps well under Floppy's limits, and the diff is small after
	// the first run. The list caches are expired once at the end.
	for (const id of add) await setItemTag('tv', 'tmdb', id, ANIME_TAG, true, { expireWatchlist: false });
	for (const id of remove) await setItemTag('tv', 'tmdb', id, ANIME_TAG, false, { expireWatchlist: false });
	if (add.length || remove.length) expireLists();

	return { added: add.length, removed: remove.length, anime: anime.size };
}

/** Tag one show right away (just added, or just overruled) for this person.
 *  Returns whether it's anime now; never throws. */
export async function classifyShow(tmdbId: string): Promise<boolean | null> {
	try {
		const me = currentUser();
		const overrides = me ? animeOverrides(me.householdId) : new Map<string, boolean>();
		let byGenre: boolean | null = null;
		if (!overrides.has(tmdbId)) {
			const d = await floppy<Raw>(`/api/v1/media/tv/tmdb/${encodeURIComponent(tmdbId)}/`);
			byGenre = animeByGenres(d.genres);
		}
		const isAnime = verdict(tmdbId, byGenre, overrides);
		if (isAnime === null) return null;
		const tagged = (await getItemTags('tv', 'tmdb', tmdbId)).includes(ANIME_TAG);
		if (tagged !== isAnime) {
			await setItemTag('tv', 'tmdb', tmdbId, ANIME_TAG, isAnime, { expireWatchlist: false });
			expireLists();
		}
		return isAnime;
	} catch (err) {
		console.warn(`[anime] classifying ${tmdbId} failed:`, err);
		return null;
	}
}
