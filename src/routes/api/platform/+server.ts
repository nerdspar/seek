import { json, error } from '@sveltejs/kit';
import { discoverByProvider, tmdbConfigured, type ProviderMode } from '$lib/server/tmdb';
import { memo } from '$lib/server/memo';
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
			).then((items) => ({ mode, items }))
		)
	);

	return json({ rows });
};
