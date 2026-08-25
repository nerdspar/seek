import { getStats, type RangeKey, type Stats } from '$lib/server/stats';
import { memo } from '$lib/server/memo';
import { getPrefs } from '$lib/server/prefs';
import type { PageServerLoad } from './$types';

const RANGES: RangeKey[] = ['this_month', 'this_year', 'last_year', 'all_time'];

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('range') as RangeKey | null;
	const range: RangeKey = requested && RANGES.includes(requested) ? requested : 'all_time';

	/* Streamed, not awaited. Floppy takes 9.4s to compute an all-time overview,
	   and blocking the navigation on that made the tab look dead — the shell now
	   renders immediately and the numbers arrive when they arrive.
	   Cached for 30 minutes and warmed at boot, so in practice it is never slow:
	   a slightly stale hours count is harmless, a 9.5s stall is not. */
	const stats: Promise<Stats> = memo(`stats:${range}`, 30 * 60 * 1000, () => getStats(range));

	return { range, stats, prefs: await getPrefs() };
};
