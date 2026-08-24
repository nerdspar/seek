import { getUpcoming } from '$lib/server/upcoming';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	try {
		return { items: await getUpcoming(), error: null };
	} catch (err) {
		return { items: [], error: err instanceof Error ? err.message : String(err) };
	}
};
