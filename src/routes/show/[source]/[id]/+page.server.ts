import { FLOPPY_PUBLIC_URL } from '$lib/server/env';
import { getShow } from '$lib/server/detail';
import { getTracking, UNTRACKED } from '$lib/server/tracking';
import { getPrefs } from '$lib/server/prefs';
import { getItemTags, JOINT_TAG } from '$lib/server/tags';
import { getShowExtras } from '$lib/server/tmdb';
import { memo } from '$lib/server/memo';
import type { PageServerLoad } from './$types';
import { currentUser } from '$lib/server/userctx';
import { mirrorMembers } from '$lib/server/household/mirror';
import { isShared } from '$lib/server/household/shared';

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
			getShow(params.source, params.id, e.seasonEpisodes, e.lastAired)
		)
	);

	/* Status and score are not on the detail response — see tracking.ts — so this
	   is a second read, streamed alongside rather than blocking the shell. It
	   needs the title to search by, so it chains off the show. */
	const tracking = show
		.then((d) => getTracking('tv', params.source, params.id, d.title))
		.catch(() => UNTRACKED);

	/* With two people on Floppy, "together" *is* the household's shared list
	   (plays mirror between you; everyone's tag is kept in step with it), so a
	   show your partner shared reads as together for you too. */
	const me = currentUser();
	const members = me ? mirrorMembers(me.householdId) : [];
	const mirroring = members.length >= 2;
	const shared = mirroring && me ? isShared(me.householdId, params.source, params.id) : false;
	const joint = mirroring
		? Promise.resolve(shared)
		: getItemTags('tv', params.source, params.id)
				.then((tags) => tags.includes(JOINT_TAG))
				.catch(() => false);

	return {
		// Composed with tracking.floppyPath, which carries the slug Floppy requires.
		floppyBase: FLOPPY_PUBLIC_URL() || null,
		source: params.source,
		mediaId: params.id,
		show,
		extras,
		tracking,
		joint,
		// Who "together" shares with, when mirroring is on (else null).
		sharedWith: mirroring ? members.filter((m) => m.id !== me?.id).map((m) => m.name) : null,
		seasonArtwork: prefs.seasonArtwork,
		companyTracking: prefs.companyTracking
	};
};
