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
		/* TMDB first, because it carries the per-season episode counts. Fetching
		   those from Floppy costs one request per season — 869ms for an
		   eight-season show, most of this page's load time — while TMDB returns
		   them inside a call already being made for networks and recommendations.
		   Cached for a day, so it is a one-off per show. */
		const extras = await memo(`extras:${params.id}`, 24 * 60 * 60 * 1000, () =>
			getShowExtras(params.id)
		);

		const [show, prefs, tags] = await Promise.all([
			// Cached so revisiting a show is instant; marking expires it.
			memo(`show:${params.source}:${params.id}`, 5 * 60 * 1000, () =>
				getShow(params.source, params.id, extras.seasonEpisodes)
			),
			getPrefs(),
			getItemTags('tv', params.source, params.id)
		]);

		return { show, extras, seasonArtwork: prefs.seasonArtwork, joint: tags.includes(JOINT_TAG) };
	} catch (err) {
		if (err instanceof FloppyError && err.status === 404) error(404, 'Show not found in Floppy.');
		error(502, err instanceof Error ? err.message : 'Could not load that show.');
	}
};
