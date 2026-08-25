import { error } from '@sveltejs/kit';
import { getWatchlist } from '$lib/server/watchlist';
import { memo } from '$lib/server/memo';
import type { MediaType } from '$lib/types';
import type { PageServerLoad } from './$types';

const TYPES: MediaType[] = ['tv', 'movie', 'anime'];

/** Collection views (§7.2) — the same list machinery as the watchlist, but
 *  browsing rather than working through a backlog, so no next-up filter. */
const VIEWS: Record<string, { label: string; statuses: string[] }> = {
	all: { label: 'Everything', statuses: ['all'] },
	in_progress: { label: 'In progress', statuses: ['in_progress'] },
	planning: { label: 'Planning', statuses: ['planning'] },
	completed: { label: 'Completed', statuses: ['completed'] },
	// "Archive" is the spec's word for the things you have stopped watching.
	archive: { label: 'Archive', statuses: ['paused', 'dropped'] }
};

/** Browsing a collection wants different orderings than working a backlog. */
const SORTS: Record<string, { label: string; sort: string; direction: 'asc' | 'desc' }> = {
	alphabetical: { label: 'A–Z', sort: 'title', direction: 'asc' },
	recently_watched: { label: 'Recently watched', sort: 'updated', direction: 'desc' },
	recently_added: { label: 'Recently added', sort: 'added', direction: 'desc' },
	release: { label: 'Newest release', sort: 'release_date', direction: 'desc' },
	rating: { label: 'Highest rated', sort: 'score', direction: 'desc' },
	longest: { label: 'Longest', sort: 'runtime', direction: 'desc' }
};

export const load: PageServerLoad = async ({ params, url }) => {
	const mediaType = params.type as MediaType;
	if (!TYPES.includes(mediaType)) error(404, 'Unknown media type.');

	const viewKey = url.searchParams.get('view') ?? 'all';
	const view = VIEWS[viewKey] ?? VIEWS.all;
	const sortKey = url.searchParams.get('sort') ?? 'alphabetical';
	const sortDef = SORTS[sortKey] ?? SORTS.alphabetical;

	/* Streamed: only the 'all' view of each type is warmed, so any other
	   view/sort combination would otherwise block on a cold build. */
	const page = memo(`library:${mediaType}:${viewKey}:${sortKey}`, 60 * 1000, () =>
		getWatchlist(mediaType, {
			statuses: view.statuses,
			sort: sortDef.sort,
			direction: sortDef.direction,
			// The grid shows poster, title and progress only — no next-up — so
			// paging the whole library is cheap without per-row enrichment.
			all: true,
			enrich: false
		})
	);

	return {
		mediaType,
		viewKey,
		viewLabel: view.label,
		sortKey,
		sortOptions: Object.entries(SORTS).map(([key, v]) => ({ key, label: v.label })),
		page
	};
};
