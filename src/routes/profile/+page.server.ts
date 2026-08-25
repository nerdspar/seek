import { getStats, type RangeKey, type Stats } from '$lib/server/stats';
import { memo } from '$lib/server/memo';
import { getPrefs } from '$lib/server/prefs';
import { FLOPPY_PUBLIC_URL } from '$lib/server/env';
import { knownServices } from '$lib/server/watchlist';
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

	/* Counts for the Collection rows (§7.2). Cheap — limit=1 and read the
	   pagination total — and streamed so they never delay the shell. */
	const counts = memo('collection:counts', 5 * 60 * 1000, async () => {
		const { floppy } = await import('$lib/server/floppy');
		const one = async (mediaType: string) => {
			try {
				const res = await floppy<{ pagination?: { total?: number } }>(
					`/api/v1/media/${mediaType}/`,
					{ query: { status: ['all'], limit: 1 }, timeoutMs: 30_000 }
				);
				return res.pagination?.total ?? 0;
			} catch {
				return 0;
			}
		};
		const [tv, movie] = await Promise.all([one('tv'), one('movie')]);
		return { tv, movie };
	});

	const publicUrl = FLOPPY_PUBLIC_URL();

	return {
		range,
		stats,
		counts,
		prefs: await getPrefs(),
		allServices: await memo('services:all', 6 * 60 * 60 * 1000, knownServices),
		floppyUrl: publicUrl ? `${publicUrl}/settings/` : null
	};
};
