/**
 * Tags (§11). The household watches some shows together and some alone, and
 * that split is show-level rather than per-play — so a `joint` tag on the item
 * is the whole mechanism. No Floppy changes, no per-play attribution.
 *
 * Verified against the live API:
 *   POST /api/v1/tags/ {name}                     -> 201 with an id
 *   PUT  /api/v1/media/{t}/{src}/{id}/tags/       -> requires {tag_ids: [...]}
 *   GET  /api/v1/media/{t}/?tag=joint             -> filters by tag NAME, not id
 *   ...&tag_mode=not                              -> the inverse
 */
import { floppy } from './floppy';
import { expire } from './memo';

export const JOINT_TAG = 'joint';
/** Mirrors Jellyfin's Anime library membership; written by the anime-sync job,
 *  read as the Shows/Anime split (see anime-sync.ts). */
export const ANIME_TAG = 'anime';

type Tag = { id: number; name: string };
type TagList = { results?: Tag[] };

export async function listTags(): Promise<Tag[]> {
	const res = await floppy<TagList>('/api/v1/tags/');
	return res.results ?? [];
}

/** Returns the tag id, creating it the first time it is needed. */
export async function ensureTag(name: string): Promise<number> {
	const existing = (await listTags()).find((t) => t.name === name);
	if (existing) return existing.id;

	const created = await floppy<Tag>('/api/v1/tags/', { method: 'POST', body: { name } });
	return created.id;
}

const tagsPath = (mediaType: string, source: string, mediaId: string) =>
	`/api/v1/media/${mediaType}/${source}/${encodeURIComponent(mediaId)}/tags/`;

export async function getItemTags(
	mediaType: string,
	source: string,
	mediaId: string
): Promise<string[]> {
	try {
		const res = await floppy<TagList>(tagsPath(mediaType, source, mediaId));
		return (res.results ?? []).map((t) => t.name);
	} catch {
		return [];
	}
}

/**
 * Add or remove one named tag on an item. The PUT replaces the whole set, so the
 * current tags are read first — otherwise toggling one tag would silently drop
 * any other tag the item has in Floppy. Returns the item's resulting tag names.
 *
 * `expireWatchlist` is on by default (an interactive toggle should refresh the
 * lists at once); the bulk anime-sync turns it off and expires once at the end.
 */
export async function setItemTag(
	mediaType: string,
	source: string,
	mediaId: string,
	tag: string,
	present: boolean,
	{ expireWatchlist = true }: { expireWatchlist?: boolean } = {}
): Promise<string[]> {
	const [all, current] = await Promise.all([
		listTags(),
		getItemTags(mediaType, source, mediaId)
	]);

	const next = new Set(current);
	if (present) next.add(tag);
	else next.delete(tag);

	const byName = new Map(all.map((t) => [t.name, t.id]));
	if (present && !byName.has(tag)) byName.set(tag, await ensureTag(tag));

	const tagIds = [...next].map((name) => byName.get(name)).filter((id): id is number => id != null);

	await floppy(tagsPath(mediaType, source, mediaId), { method: 'PUT', body: { tag_ids: tagIds } });
	if (expireWatchlist) expire('watchlist:');
	return [...next];
}

/** Add or remove the joint tag (the household "watched together" flag). */
export function setJoint(
	mediaType: string,
	source: string,
	mediaId: string,
	joint: boolean
): Promise<string[]> {
	return setItemTag(mediaType, source, mediaId, JOINT_TAG, joint);
}

/** Query params for the Solo / Joint / All filter (§11). */
export type Company = 'all' | 'joint' | 'solo';

export function companyQuery(company: Company): Record<string, string | undefined> {
	if (company === 'joint') return { tag: JOINT_TAG };
	if (company === 'solo') return { tag: JOINT_TAG, tag_mode: 'not' };
	return {};
}
