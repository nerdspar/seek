/**
 * Discover (§6). Floppy's own rows come first — its personalisation is already
 * doing the work §6.1 describes, including "because you watched"-style rows
 * driven by local history ("Top Picks For You", "Comfort Rewatches"), each with
 * a `why` explaining itself. Rolling our own on top would be worse and slower.
 *
 * Floppy also returns `match_signal`, which is deliberately dropped. Every row
 * that has one phrases it as "Driven by your current <tags> phase" using the
 * same handful of tags in a different order, so on screen the rows all appeared
 * to say the same thing.
 */
import { floppy } from './floppy';
import type { MediaType } from '$lib/types';

export type DiscoverItem = {
	mediaId: string;
	source: string;
	mediaType: 'tv' | 'movie';
	title: string;
	poster: string | null;
	year: number | null;
	rating: number | null;
};

export type DiscoverRow = {
	key: string;
	title: string;
	why: string | null;
	/** Floppy's own explanation of what drove a personalised row. */
	items: DiscoverItem[];
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function mapItem(raw: unknown): DiscoverItem | null {
	const i = rec(raw);
	const mediaId = String(i.media_id ?? '');
	if (!mediaId) return null;
	const mt = str(i.media_type);
	const release = str(i.release_date);
	return {
		mediaId,
		source: str(i.source) ?? 'tmdb',
		mediaType: mt === 'movie' ? 'movie' : 'tv',
		title: str(i.title) ?? 'Untitled',
		poster: str(i.image),
		year: release && release.length >= 4 ? Number(release.slice(0, 4)) : null,
		rating: typeof i.rating === 'number' ? Math.round(i.rating * 10) / 10 : null
	};
}

export async function getDiscoverRows(mediaType: MediaType): Promise<DiscoverRow[]> {
	const res = rec(await floppy(`/api/v1/discover/`, { query: { media_type: mediaType } }));

	return arr(res.rows)
		.map((raw): DiscoverRow | null => {
			const r = rec(raw);
			const items = arr(r.items)
				.map(mapItem)
				.filter((i): i is DiscoverItem => i !== null);
			if (!items.length) return null;
			return {
				key: str(r.key) ?? str(r.title) ?? 'row',
				title: str(r.title) ?? 'More',
				why: str(r.why),
				items
			};
		})
		.filter((r): r is DiscoverRow => r !== null);
}
