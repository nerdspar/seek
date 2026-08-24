import { error } from '@sveltejs/kit';
import { getShow } from '$lib/server/detail';
import { FloppyError } from '$lib/server/floppy';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		return { show: await getShow(params.source, params.id) };
	} catch (err) {
		if (err instanceof FloppyError && err.status === 404) error(404, 'Show not found in Floppy.');
		error(502, err instanceof Error ? err.message : 'Could not load that show.');
	}
};
