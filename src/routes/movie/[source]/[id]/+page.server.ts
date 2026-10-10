import { getMovie } from '$lib/server/detail';
import { getItemTags, JOINT_TAG } from '$lib/server/tags';
import { getPrefs } from '$lib/server/prefs';
import { getTracking, UNTRACKED } from '$lib/server/tracking';
import { getMovieExtras } from '$lib/server/tmdb';
import { memo } from '$lib/server/memo';
import type { PageServerLoad } from './$types';

/**
 * A film's page. Separate from the show route because that one is built around
 * seasons and episodes, which a movie has none of.
 */
export const load: PageServerLoad = async ({ params }) => {
	/* Streamed rather than awaited, same as the show page. */
	const movie = memo(`movie:${params.source}:${params.id}`, 5 * 60 * 1000, () => getMovie(params.source, params.id));

	/* Where to watch and "more like this", from TMDB. */
	const extras = memo(`extras:movie:${params.id}`, 24 * 60 * 60 * 1000, () => getMovieExtras(params.id));

	const prefs = await getPrefs();

	/* "Together" is the household's shared list, as on the show page. Skipped
	   when the feature is off, so nothing is read for a chip that won't render. */
	const joint = !prefs.companyTracking
		? Promise.resolve(false)
		: getItemTags('movie', params.source, params.id)
				.then((tags) => tags.includes(JOINT_TAG))
				.catch(() => false);

	return {
		source: params.source,
		mediaId: params.id,
		companyTracking: prefs.companyTracking,
		joint,
		movie,
		extras,
		tracking: getTracking('movie', params.source, params.id).catch(() => UNTRACKED)
	};
};
