import { error } from '@sveltejs/kit';
import { getWatchlist } from '$lib/server/watchlist';
import { memo } from '$lib/server/memo';
import type { MediaType } from '$lib/types';
import type { PageServerLoad } from './$types';

const TYPES: MediaType[] = ['tv', 'movie', 'anime'];

/** Collection views (§7.2) — the same list machinery as the watchlist, but
 *  browsing rather than working through a backlog, so no next-up filter. */
const VIEWS: Record<string, { label: string; statuses: string[]; sort: string; direction: 'asc' | 'desc' }> = {
	all: { label: 'Everything', statuses: ['all'], sort: 'title', direction: 'asc' },
	in_progress: { label: 'In progress', statuses: ['in_progress'], sort: 'updated', direction: 'desc' },
	planning: { label: 'Planning', statuses: ['planning'], sort: 'title', direction: 'asc' },
	completed: { label: 'Completed', statuses: ['completed'], sort: 'updated', direction: 'desc' },
	// "Archive" is the spec's word for the things you have stopped watching.
	archive: { label: 'Archive', statuses: ['paused', 'dropped'], sort: 'updated', direction: 'desc' }
};

export const load: PageServerLoad = async ({ params, url }) => {
	const mediaType = params.type as MediaType;
	if (!TYPES.includes(mediaType)) error(404, 'Unknown media type.');

	const viewKey = url.searchParams.get('view') ?? 'all';
	const view = VIEWS[viewKey] ?? VIEWS.all;

	try {
		const page = await memo(`library:${mediaType}:${viewKey}`, 60 * 1000, () =>
			getWatchlist(mediaType, {
				statuses: view.statuses,
				sort: view.sort,
				direction: view.direction,
				// The grid shows poster, title and progress only — no next-up — so
				// paging the whole library is cheap without per-row enrichment.
				all: true,
				enrich: false
			})
		);
		return { mediaType, viewKey, viewLabel: view.label, ...page, error: null };
	} catch (err) {
		return {
			mediaType,
			viewKey,
			viewLabel: view.label,
			rows: [],
			total: 0,
			hasMore: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
};
