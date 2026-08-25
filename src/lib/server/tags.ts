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
import { invalidate } from './memo';

export const JOINT_TAG = 'joint';

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
 * Add or remove the joint tag. The PUT replaces the whole set, so the current
 * tags are read first — otherwise toggling `joint` would silently drop any
 * other tag the user has applied in Floppy.
 */
export async function setJoint(
	mediaType: string,
	source: string,
	mediaId: string,
	joint: boolean
): Promise<string[]> {
	const [all, current] = await Promise.all([
		listTags(),
		getItemTags(mediaType, source, mediaId)
	]);

	const next = new Set(current);
	if (joint) next.add(JOINT_TAG);
	else next.delete(JOINT_TAG);

	const byName = new Map(all.map((t) => [t.name, t.id]));
	if (joint && !byName.has(JOINT_TAG)) byName.set(JOINT_TAG, await ensureTag(JOINT_TAG));

	const tagIds = [...next].map((name) => byName.get(name)).filter((id): id is number => id != null);

	await floppy(tagsPath(mediaType, source, mediaId), { method: 'PUT', body: { tag_ids: tagIds } });
	invalidate('watchlist:');
	return [...next];
}

/** Query params for the Solo / Joint / All filter (§11). */
export type Company = 'all' | 'joint' | 'solo';

export function companyQuery(company: Company): Record<string, string | undefined> {
	if (company === 'joint') return { tag: JOINT_TAG };
	if (company === 'solo') return { tag: JOINT_TAG, tag_mode: 'not' };
	return {};
}
