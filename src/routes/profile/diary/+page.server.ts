import { getDiary } from '$lib/server/stats';
import { getPrefs } from '$lib/server/prefs';
import { myBookList } from '$lib/server/books/discovery';
import { bookorbitConfigured } from '$lib/server/books/bookorbit';
import { hardcoverConfigured } from '$lib/server/books/hardcover';
import { mediaOn } from '$lib/media';
import type { PageServerLoad } from './$types';

const PAGE = 20;

export const load: PageServerLoad = async ({ url }) => {
	/* Paged by day rather than infinite-scrolled from the top: the history spans
	   790 days, and jumping straight to a point in the past should not mean
	   loading everything in between. The endpoint is fast (~20ms), so paging is
	   cheap. */
	const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);

	/* Two diaries: what you watched (your plays) and what you read (started and
	   finished books). Only the kinds you have switched on are offered. */
	const media = mediaOn(await getPrefs(), bookorbitConfigured() || hardcoverConfigured());
	const watchingOn = media.tv || media.movie;
	const view: 'watching' | 'reading' =
		(url.searchParams.get('view') === 'reading' || !watchingOn) && media.book ? 'reading' : 'watching';

	// Streamed: only offset 0 is ever warm, so paging back would otherwise block.
	return {
		offset,
		pageSize: PAGE,
		media,
		view,
		result: view === 'watching' ? getDiary(offset, PAGE) : null,
		books: view === 'reading' ? myBookList().catch(() => []) : null
	};
};
