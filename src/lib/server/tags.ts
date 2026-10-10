/**
 * The two labels a title can carry (§11), both Seek's own:
 * - `joint`: watched together — the household's shared list (household/shared.ts);
 * - `anime`: the Shows/Anime split — Seek's rule plus household overrides (anime-sync.ts).
 */
import { currentUser } from './userctx';
import { isShared } from './household/shared';
import { setShared } from './household/run';
import { isAnime } from './anime-sync';
import { expire } from './memo';

export const JOINT_TAG = 'joint';
export const ANIME_TAG = 'anime';

const kindOf = (mediaType: string) => (mediaType === 'movie' ? 'movie' : 'tv');

/** The labels on one title for the signed-in person's household. */
export async function getItemTags(mediaType: string, source: string, mediaId: string): Promise<string[]> {
	const me = currentUser();
	if (!me) return [];
	const tags: string[] = [];
	if (isShared(me.householdId, source, mediaId, kindOf(mediaType))) tags.push(JOINT_TAG);
	if (mediaType !== 'movie' && source === 'tmdb' && isAnime(me.householdId, mediaId)) tags.push(ANIME_TAG);
	return tags;
}

/** Watched together or not: shares or unshares it for the household. */
export async function setJoint(mediaType: string, source: string, mediaId: string, joint: boolean, title: string | null = null): Promise<string[]> {
	const me = currentUser();
	if (!me) return [];
	setShared(me.householdId, me.id, { source, mediaId, mediaType: kindOf(mediaType), title }, joint);
	expire('watchlist:');
	return getItemTags(mediaType, source, mediaId);
}

/** Solo / Joint / All (§11). */
export type Company = 'all' | 'joint' | 'solo';

/** The watchlist's anime filter. */
export type AnimeFilter = 'all' | 'only' | 'hide';

/** getWatchlist tag options for the anime filter: 'only' keeps the anime
 *  shows, 'hide' keeps the rest, 'all' applies no anime filter. */
export function animeTagQuery(filter: AnimeFilter): { tag?: string; tagMode?: 'not' } {
	if (filter === 'only') return { tag: ANIME_TAG };
	if (filter === 'hide') return { tag: ANIME_TAG, tagMode: 'not' };
	return {};
}
