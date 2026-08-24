import { json } from '@sveltejs/kit';
import { getWatchlist } from '$lib/server/watchlist';
import type { MediaType } from '$lib/types';
import type { RequestHandler } from './$types';

/** Background row refresh after a mark (§4.2) and pagination. */
export const GET: RequestHandler = async ({ url }) => {
	const mediaType = (url.searchParams.get('type') ?? 'tv') as MediaType;
	const offset = Number(url.searchParams.get('offset') ?? 0);
	const sort = url.searchParams.get('sort') ?? 'updated';
	const direction = (url.searchParams.get('direction') ?? 'desc') as 'asc' | 'desc';

	const page = await getWatchlist(mediaType, { offset, sort, direction });
	return json(page);
};
