import { redirect } from '@sveltejs/kit';
import { getDiscoverRows } from '$lib/server/discover';
import { configured } from '$lib/server/arr';
import { memo } from '$lib/server/memo';
import { getPrefs } from '$lib/server/prefs';
import { hardcoverConfigured } from '$lib/server/books/hardcover';
import { landing, mediaOn } from '$lib/media';
import type { MediaType } from '$lib/types';
import type { PageServerLoad } from './$types';

/**
 * Discover: curated shelves (Trending, Because you like…, Coming Soon). Finding
 * a specific title, actor, mood or tag is the unified search's job now (the
 * floating button), so this page is just the browse-without-effort rows.
 */
export const load: PageServerLoad = async ({ url }) => {
	const requested = url.searchParams.get('type') as MediaType | null;
	const prefs = await getPrefs();

	/* Shows / movies / books each switch off per person: land on one that's on —
	   book discovery when it's the only one. */
	const media = mediaOn(prefs, hardcoverConfigured());
	const kind = landing(requested === 'movie' ? 'movie' : requested === 'tv' ? 'tv' : null, media);
	if (kind === 'book') redirect(307, '/discover/books');
	const mediaType: MediaType = kind;

	return {
		books: media.book,
		media,
		mediaType,
		/* Streamed. These rows are built from TMDB and change slowly, so a stale
		   read is fine and a blocking rebuild is not. */
		rows: memo(`discover:${mediaType}`, 30 * 60 * 1000, () => getDiscoverRows(mediaType)),
		/* The header's way to what's on the server but not on your list. */
		onServer: configured(mediaType === 'movie' ? 'radarr' : 'sonarr')
	};
};
