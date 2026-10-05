import { error } from '@sveltejs/kit';
import { onServerNotListed } from '$lib/server/onServer';
import type { PageServerLoad } from './$types';

/** Discover → On the server: every Sonarr show / Radarr movie that isn't on
 *  your list, as a grid — the shows side of Books' "In my library". */
export const load: PageServerLoad = async ({ params }) => {
	const mediaType = params.type === 'movie' ? 'movie' : params.type === 'tv' ? 'tv' : null;
	if (!mediaType) error(404, 'Unknown media type.');
	const titles = onServerNotListed(mediaType);
	if (!titles) error(404, `${mediaType === 'tv' ? 'Sonarr' : 'Radarr'} isn't set up.`);
	return { mediaType, titles };
};
