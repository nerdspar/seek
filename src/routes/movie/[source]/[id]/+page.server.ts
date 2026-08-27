import { FLOPPY_PUBLIC_URL } from '$lib/server/env';
import { getMovie } from '$lib/server/detail';
import { getItemTags, JOINT_TAG } from '$lib/server/tags';
import { getPrefs } from '$lib/server/prefs';
import { getTracking, UNTRACKED } from '$lib/server/tracking';
import { getMovieExtras } from '$lib/server/tmdb';
import { memo } from '$lib/server/memo';
import type { PageServerLoad } from './$types';

/**
 * A film's page. Separate from the show route because that one is built around
 * seasons and episodes — which a movie has none of — and every one of its
 * Floppy calls addresses the `tv` path.
 */
export const load: PageServerLoad = async ({ params }) => {
	/* Streamed rather than awaited, same as the show page: blocking here meant a
	   tap produced nothing until the data arrived, which reads as a frozen app. */
	const movie = memo(`movie:${params.source}:${params.id}`, 5 * 60 * 1000, () =>
		getMovie(params.source, params.id)
	);

	/* Where to watch and "more like this". The helper is named for shows but is
	   really a TMDB lookup by id; the movie endpoint answers the same shape. */
	const extras = memo(`extras:movie:${params.id}`, 24 * 60 * 60 * 1000, () =>
		getMovieExtras(params.id)
	);

	const prefs = await getPrefs();

	/* Company applies to films too — verified live that Floppy stores and filters
	   the tag on a movie. Skipped entirely when the feature is off, so nothing
	   is fetched for a chip that will not render. */
	const joint = prefs.companyTracking
		? getItemTags('movie', params.source, params.id)
				.then((tags) => tags.includes(JOINT_TAG))
				.catch(() => false)
		: Promise.resolve(false);

	// Status and score live on the list row, not the detail — see tracking.ts.
	const tracking = movie
		.then((m) => getTracking('movie', params.source, params.id, m.title))
		.catch(() => UNTRACKED);

	return {
		// Composed with tracking.floppyPath, which carries the slug Floppy requires.
		floppyBase: FLOPPY_PUBLIC_URL() || null,
		source: params.source,
		mediaId: params.id,
		companyTracking: prefs.companyTracking,
		joint,
		movie,
		extras,
		tracking
	};
};
