import { error } from '@sveltejs/kit';
import { getShow } from '$lib/server/detail';
import { FloppyError } from '$lib/server/floppy';
import { getPrefs } from '$lib/server/prefs';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const [show, prefs] = await Promise.all([getShow(params.source, params.id), getPrefs()]);
		return { show, seasonArtwork: prefs.seasonArtwork };
	} catch (err) {
		if (err instanceof FloppyError && err.status === 404) error(404, 'Show not found in Floppy.');
		error(502, err instanceof Error ? err.message : 'Could not load that show.');
	}
};
