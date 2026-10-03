import { getWatchlist } from '$lib/server/watchlist';
import { memo } from '$lib/server/memo';
import { getPrefs, SORTS, sortFor } from '$lib/server/prefs';
import { type Company, type AnimeFilter, animeTagQuery } from '$lib/server/tags';
import { jellyfinConfigured } from '$lib/server/jellyfin';
import { bookorbitConfigured } from '$lib/server/books/bookorbit';
import { hardcoverConfigured } from '$lib/server/books/hardcover';
import { landing, mediaOn } from '$lib/media';
import type { MediaType } from '$lib/types';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const TYPES: MediaType[] = ['tv', 'movie', 'anime'];
const COMPANIES: Company[] = ['all', 'joint', 'solo'];
const ANIME_FILTERS: AnimeFilter[] = ['all', 'only', 'hide'];
const STATUSES = ['in_progress', 'planning', 'completed', 'paused', 'dropped', 'all'];

export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('type') as MediaType | null;

	/* Sort lives in server-side preferences (§4.5, §8) rather than the browser:
	   a default kept client-side would render one order and reshuffle on hydrate.
	   Filters are URL state instead — they are a transient view of the list, and
	   putting them in the URL makes back/forward behave and keeps them shareable
	   between the two segments. */
	const prefs = await getPrefs();

	/* Shows / movies / books each switch off per person: land on one that's on —
	   the Books page when it's the only one. */
	const media = mediaOn(prefs, bookorbitConfigured() || hardcoverConfigured());
	const kind = landing(requested === 'movie' ? 'movie' : requested === 'tv' ? 'tv' : null, media);
	if (kind === 'book') redirect(307, '/books');
	const mediaType: MediaType = kind;

	/* §8's default tab. Only redirect on a bare visit — never when the URL is
	   already carrying filters or a segment, or a filtered link would bounce. */
	if (prefs.defaultTab !== 'watchlist' && url.search === '') {
		redirect(307, `/${prefs.defaultTab}`);
	}

	const sortKey = sortFor(prefs, mediaType);
	const { sort, direction } = SORTS[sortKey];

	/* Films are watched or they are not. Floppy does accept all five statuses on
	   one — and the Jellyfin webhook writes In progress while a film is playing —
	   but a library of 53 held 53 Completed and nothing else, so defaulting this
	   tab to the in-progress backlog that makes the TV tab useful renders it
	   empty however full the library is. Movies open on everything instead, and
	   the chips narrow it. */
	const fallbackStatus = mediaType === 'movie' ? 'all' : 'in_progress';
	const rawStatus = url.searchParams.get('status') ?? fallbackStatus;
	const status = STATUSES.includes(rawStatus) ? rawStatus : fallbackStatus;
	/* Forced back to 'all' when the household does not track company: an old link
	   or a stale back-entry would otherwise filter the list by a control that is
	   no longer on screen to undo it. */
	const rawCompany = prefs.companyTracking ? (url.searchParams.get('company') ?? 'all') : 'all';
	const company = (COMPANIES as string[]).includes(rawCompany) ? (rawCompany as Company) : 'all';
	const services = url.searchParams.getAll('service').filter(Boolean);

	/* The Shows/Anime split is a Jellyfin-sourced `anime` tag (see anime-sync.ts),
	   and it only exists on the tv list — so the anime filter is offered only there
	   and only when Jellyfin is configured. 'only' keeps the tagged shows, 'hide'
	   keeps the rest; both take precedence over company (also a tag) in getWatchlist. */
	const showAnime = jellyfinConfigured() && mediaType === 'tv';
	const rawAnime = showAnime ? (url.searchParams.get('anime') ?? 'all') : 'all';
	const anime = (ANIME_FILTERS as string[]).includes(rawAnime)
		? (rawAnime as AnimeFilter)
		: 'all';
	const animeTag = animeTagQuery(anime);

	const filters = { status, company, anime, services };
	const key = `watchlist:${mediaType}:${sortKey}:${status}:${company}:${anime}:${services.join('+')}`;

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
			services,
			...animeTag
		})
	);

	return {
		// The Books segment: your setting, and a BookOrbit to read from.
		books: media.book,
		media,
		mediaType,
		sortKey,
		filters,
		markDirection: prefs.markDirection,
		subscribed: prefs.services,
		companyTracking: prefs.companyTracking,
		showAnime,
		page
	};
};
