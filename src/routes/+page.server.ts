import { getWatchlist, knownServices } from '$lib/server/watchlist';
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

	const rawStatus = url.searchParams.get('status') ?? 'in_progress';
	const status = STATUSES.includes(rawStatus) ? rawStatus : 'in_progress';
	const rawCompany = url.searchParams.get('company') ?? 'all';
	const company = (COMPANIES as string[]).includes(rawCompany) ? (rawCompany as Company) : 'all';
	const services = url.searchParams.getAll('service').filter(Boolean);

	const filters = { status, company, services };
	const key = `watchlist:${mediaType}:${sortKey}:${status}:${company}:${services.join('+')}`;

	try {
		/* Deliberately awaited rather than streamed: this is the launch screen, and
		   server-rendered rows beat an instant empty shell on a cold start. The
		   short cache is what keeps the 1.2s Floppy query off the critical path
		   for tab switches. Marking invalidates it. */
		const page = await memo(key, 60 * 1000, () =>
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
			allServices: await memo('services:all', 6 * 60 * 60 * 1000, knownServices),
			...page,
			error: null
		};
	} catch (err) {
		return {
			mediaType,
			sortKey,
			filters,
			markDirection: prefs.markDirection,
			subscribed: prefs.services,
			allServices: [],
			rows: [],
			total: 0,
			hasMore: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
};
