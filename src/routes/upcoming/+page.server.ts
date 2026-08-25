import { getUpcoming } from '$lib/server/upcoming';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	/* Streamed. The cold path builds a library index — ~13s — and while the boot
	   warmup covers it, a cold container should still paint the tab instantly. */
	return { items: getUpcoming() };
};
