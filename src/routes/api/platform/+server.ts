import { json, error } from '@sveltejs/kit';
import { discoverByProvider, tmdbConfigured, type ProviderMode } from '$lib/server/tmdb';
import { memo } from '$lib/server/memo';
import { withoutTracked } from '$lib/server/search';
import type { RequestHandler } from './$types';

/** Trending and newly-arrived titles on one streaming service (§6.3). */
export const GET: RequestHandler = async ({ url }) => {
	if (!tmdbConfigured()) error(503, 'TMDB_API_KEY is not set — platform browsing is unavailable.');

	const providerId = Number(url.searchParams.get('id'));
	if (!Number.isInteger(providerId)) error(400, 'A numeric provider id is required.');
	const mediaType = url.searchParams.get('type') === 'movie' ? 'movie' : 'tv';

	const rows = await Promise.all(
		(['trending', 'new'] as ProviderMode[]).map((mode) =>
			memo(`platform:${providerId}:${mediaType}:${mode}`, 6 * 60 * 60 * 1000, () =>
				discoverByProvider(providerId, mediaType, mode)
			)
				// Filtered outside the cache: what you track changes far more often
				// than what a service is trending, and the two should not share a TTL.
				.then((items) => withoutTracked(mediaType, items))
				.then((items) => ({ mode, items }))
		)
	);

	return json({ rows: rows.filter((r) => r.items.length) });
};
