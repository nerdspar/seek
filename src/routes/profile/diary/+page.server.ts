import { getDiary } from '$lib/server/stats';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	try {
		return { ...(await getDiary()), error: null };
	} catch (err) {
		return { days: [], hasMore: false, error: err instanceof Error ? err.message : String(err) };
	}
};
