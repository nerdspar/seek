import { getShow } from '$lib/server/detail';
import { getPrefs } from '$lib/server/prefs';
import { getItemTags, JOINT_TAG } from '$lib/server/tags';
import { getShowExtras } from '$lib/server/tmdb';
import { memo } from '$lib/server/memo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	/* Streamed rather than awaited.
	   Blocking here meant a tap produced nothing at all until the data arrived —
	   which reads as a frozen app and invites a second tap. Returning promises
	   lets the page render its shell immediately and fill in, so the tap always
	   does something visible.

	   Only the preference is awaited: it is a local file read, and the layout
	   depends on it. */
	const prefs = await getPrefs();

	/* TMDB carries the per-season episode counts, and fetching those from Floppy
	   instead costs one request per season. So it leads, and getShow reuses them.
	   Both are cached, so a revisit resolves instantly and no skeleton is seen. */
	const extras = memo(`extras:${params.id}`, 24 * 60 * 60 * 1000, () => getShowExtras(params.id));

	const show = extras.then((e) =>
		memo(`show:${params.source}:${params.id}`, 5 * 60 * 1000, () =>
			getShow(params.source, params.id, e.seasonEpisodes)
		)
	);

	const joint = getItemTags('tv', params.source, params.id)
		.then((tags) => tags.includes(JOINT_TAG))
		.catch(() => false);

	return {
		source: params.source,
		mediaId: params.id,
		show,
		extras,
		joint,
		seasonArtwork: prefs.seasonArtwork
	};
};
