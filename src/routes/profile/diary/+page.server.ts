import { getDiary } from '$lib/server/stats';
import { memo } from '$lib/server/memo';
import type { PageServerLoad } from './$types';

const PAGE = 20;

export const load: PageServerLoad = async ({ url }) => {
	/* Paged by day rather than infinite-scrolled from the top: the history spans
	   790 days, and jumping straight to a point in the past should not mean
	   loading everything in between. The endpoint is fast (~20ms), so paging is
	   cheap. */
	const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);

	try {
		const result = await memo(`diary:${offset}`, 5 * 60 * 1000, () => getDiary(offset, PAGE));
		return { ...result, offset, pageSize: PAGE, error: null };
	} catch (err) {
		return {
			days: [],
			hasMore: false,
			total: 0,
			offset,
			pageSize: PAGE,
			error: err instanceof Error ? err.message : String(err)
		};
	}
};
