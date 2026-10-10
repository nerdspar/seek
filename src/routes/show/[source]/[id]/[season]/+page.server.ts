import { error } from '@sveltejs/kit';
import { getSeason } from '$lib/server/detail';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const seasonNumber = Number(params.season);
	if (!Number.isInteger(seasonNumber)) error(400, 'Season must be a number.');

	/* Streamed, so tapping a season paints immediately and fills in — a season is
	   never pre-warmed, and blocking here is what makes a tap read as a freeze. */
	return {
		source: params.source,
		mediaId: params.id,
		seasonNumber,
		// Always fresh: Seek's own tables, milliseconds.
		season: getSeason(params.source, params.id, seasonNumber)
	};
};
