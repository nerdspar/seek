import { error } from '@sveltejs/kit';
import { getShow } from '$lib/server/detail';
import { FloppyError } from '$lib/server/floppy';
import { getPrefs } from '$lib/server/prefs';
import { getItemTags, JOINT_TAG } from '$lib/server/tags';
import { getShowExtras } from '$lib/server/tmdb';
import { memo } from '$lib/server/memo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const [show, prefs, tags] = await Promise.all([
			getShow(params.source, params.id),
			getPrefs(),
			getItemTags('tv', params.source, params.id)
		]);

		/* Networks, streaming services and similar shows come from TMDB — Floppy
		   has none of them at show level. Streamed rather than awaited so the page
		   paints immediately and the extras fill in. */
		const extras = memo(`extras:${params.id}`, 24 * 60 * 60 * 1000, () =>
			getShowExtras(params.id)
		);

		return { show, extras, seasonArtwork: prefs.seasonArtwork, joint: tags.includes(JOINT_TAG) };
	} catch (err) {
		if (err instanceof FloppyError && err.status === 404) error(404, 'Show not found in Floppy.');
		error(502, err instanceof Error ? err.message : 'Could not load that show.');
	}
};
