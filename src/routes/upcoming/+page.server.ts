import { getUpcoming } from '$lib/server/upcoming';
import { getUpcomingExtras } from '$lib/server/upcoming-extras';
import { getPrefs } from '$lib/server/prefs';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const prefs = await getPrefs();
	/* Streamed. The cold path builds a library index — ~13s — and while the boot
	   warmup covers it, a cold container should still paint the tab instantly.
	   Films and books come separately so episodes never wait on them; they're a
	   nicety, so a failure there just means fewer rows. */
	return {
		items: getUpcoming(),
		extras: getUpcomingExtras({ books: prefs.booksEnabled }).catch(() => []),
		books: prefs.booksEnabled
	};
};
