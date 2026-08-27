import { getWatchlist } from '$lib/server/watchlist';
import { memo } from '$lib/server/memo';
import { getPrefs, SORTS, sortFor } from '$lib/server/prefs';
import type { Company } from '$lib/server/tags';
import type { MediaType } from '$lib/types';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const TYPES: MediaType[] = ['tv', 'movie', 'anime'];
const COMPANIES: Company[] = ['all', 'joint', 'solo'];
const STATUSES = ['in_progress', 'planning', 'completed', 'paused', 'dropped', 'all'];

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('type') as MediaType | null;
	const mediaType: MediaType = requested && TYPES.includes(requested) ? requested : 'tv';

	/* Sort lives in server-side preferences (§4.5, §8) rather than the browser:
	   a default kept client-side would render one order and reshuffle on hydrate.
	   Filters are URL state instead — they are a transient view of the list, and
	   putting them in the URL makes back/forward behave and keeps them shareable
	   between the two segments. */
	const prefs = await getPrefs();

	/* §8's default tab. Only redirect on a bare visit — never when the URL is
	   already carrying filters or a segment, or a filtered link would bounce. */
	if (prefs.defaultTab !== 'watchlist' && url.search === '') {
		redirect(307, `/${prefs.defaultTab}`);
	}

	const sortKey = sortFor(prefs, mediaType);
	const { sort, direction } = SORTS[sortKey];

	/* A movie has no middle. Floppy tracks it as planned or completed and nothing
	   between, so the in-progress backlog that makes the TV tab useful asks for a
	   state no movie can ever hold — the tab renders empty however full the
	   library is. Movies open on everything instead, and the chips narrow it. */
	const fallbackStatus = mediaType === 'movie' ? 'all' : 'in_progress';
	const rawStatus = url.searchParams.get('status') ?? fallbackStatus;
	const status = STATUSES.includes(rawStatus) ? rawStatus : fallbackStatus;
	/* Forced back to 'all' when the household does not track company: an old link
	   or a stale back-entry would otherwise filter the list by a control that is
	   no longer on screen to undo it. */
	const rawCompany = prefs.companyTracking ? (url.searchParams.get('company') ?? 'all') : 'all';
	const company = (COMPANIES as string[]).includes(rawCompany) ? (rawCompany as Company) : 'all';
	const services = url.searchParams.getAll('service').filter(Boolean);

	const filters = { status, company, services };
	const key = `watchlist:${mediaType}:${sortKey}:${status}:${company}:${services.join('+')}`;

	/* Streamed like every other route. This is the launch screen, so it is the
	   one most often warm — but on a cold container a blank three seconds is
	   exactly the thing this app exists to avoid, and a skeleton that appears
	   instantly beats rows that appear eventually. */
	const page = memo(key, 60 * 1000, () =>
		getWatchlist(mediaType, {
			sort,
			direction,
			statuses: status === 'all' ? ['all'] : [status],
			company,
			services
		})
	);

	return {
		mediaType,
		sortKey,
		filters,
		markDirection: prefs.markDirection,
		subscribed: prefs.services,
		companyTracking: prefs.companyTracking,
		page
	};
};
