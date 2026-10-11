import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Adding a book is the unified search's Books scope now — this page is retired
 *  and just forwards there, so the old "Add to library" link still works. */
export const load: PageServerLoad = async () => {
	redirect(308, '/search?scope=books');
};
