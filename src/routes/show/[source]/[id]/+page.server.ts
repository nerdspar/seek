import { getShow } from '$lib/server/detail';
import { getTracking, UNTRACKED } from '$lib/server/tracking';
import { getPrefs } from '$lib/server/prefs';
import { ANIME_TAG, getItemTags, JOINT_TAG } from '$lib/server/tags';
import { getShowExtras } from '$lib/server/tmdb';
import { memo } from '$lib/server/memo';
import type { PageServerLoad } from './$types';
import { currentUser } from '$lib/server/userctx';
import { mirrorMembers } from '$lib/server/household/mirror';

export const load: PageServerLoad = async ({ params }) => {
	/* Streamed rather than awaited: the page renders its shell at once and fills
	   in, so a tap always does something visible. Only the preference is awaited. */
	const prefs = await getPrefs();

	// Where to watch, networks, similar titles: TMDB, cached a day.
	const extras = memo(`extras:${params.id}`, 24 * 60 * 60 * 1000, () => getShowExtras(params.id));
	const show = memo(`show:${params.source}:${params.id}`, 5 * 60 * 1000, () => getShow(params.source, params.id));
	const tracking = getTracking('tv', params.source, params.id).catch(() => UNTRACKED);

	/* "Together" is the household's shared list: a play by either of you counts
	   for both, so a show your partner shared reads as together for you too. */
	const me = currentUser();
	const members = me ? mirrorMembers(me.householdId) : [];
	const tags = getItemTags('tv', params.source, params.id).catch(() => [] as string[]);
	const joint = tags.then((t) => t.includes(JOINT_TAG));
	// Whether it counts as anime (the Shows/Anime split), for the menu's switch.
	const anime = params.source === 'tmdb' ? tags.then((t) => t.includes(ANIME_TAG)) : Promise.resolve(null);

	return {
		source: params.source,
		mediaId: params.id,
		show,
		extras,
		tracking,
		joint,
		anime,
		// Who "together" shares with, when there's someone to share with (else null).
		sharedWith: members.length >= 2 ? members.filter((m) => m.id !== me?.id).map((m) => m.name) : null,
		seasonArtwork: prefs.seasonArtwork,
		companyTracking: prefs.companyTracking
	};
};
