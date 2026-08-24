import { getStats, type RangeKey } from '$lib/server/stats';
import type { PageServerLoad } from './$types';

const RANGES: RangeKey[] = ['this_month', 'this_year', 'last_year', 'all_time'];

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('range') as RangeKey | null;
	const range: RangeKey = requested && RANGES.includes(requested) ? requested : 'all_time';

	try {
		return { range, stats: await getStats(range), error: null };
	} catch (err) {
		return { range, stats: null, error: err instanceof Error ? err.message : String(err) };
	}
};
