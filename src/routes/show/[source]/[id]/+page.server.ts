import { error } from '@sveltejs/kit';
import { getShow } from '$lib/server/detail';
import { FloppyError } from '$lib/server/floppy';
import { getPrefs } from '$lib/server/prefs';
import { getItemTags, JOINT_TAG } from '$lib/server/tags';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const [show, prefs, tags] = await Promise.all([
			getShow(params.source, params.id),
			getPrefs(),
			getItemTags('tv', params.source, params.id)
		]);
		return { show, seasonArtwork: prefs.seasonArtwork, joint: tags.includes(JOINT_TAG) };
	} catch (err) {
		if (err instanceof FloppyError && err.status === 404) error(404, 'Show not found in Floppy.');
		error(502, err instanceof Error ? err.message : 'Could not load that show.');
	}
};
