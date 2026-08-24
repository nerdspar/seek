import { error } from '@sveltejs/kit';
import { getSeason } from '$lib/server/detail';
import { FloppyError } from '$lib/server/floppy';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const season = Number(params.season);
	if (!Number.isInteger(season)) error(400, 'Season must be a number.');

	try {
		return { season: await getSeason(params.source, params.id, season) };
	} catch (err) {
		if (err instanceof FloppyError && err.status === 404) error(404, 'Season not found in Floppy.');
		error(502, err instanceof Error ? err.message : 'Could not load that season.');
	}
};
