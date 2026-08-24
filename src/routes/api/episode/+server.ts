import { json, error } from '@sveltejs/kit';
import { getEpisode } from '$lib/server/detail';
import { FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import type { RequestHandler } from './$types';

/** Backs the episode sheet (§4.4). A sheet, not a page — so this is fetched
 *  rather than loaded through a route. */
export const GET: RequestHandler = async ({ url }) => {
	const source = url.searchParams.get('source') ?? 'tmdb';
	const mediaId = url.searchParams.get('mediaId');
	const season = Number(url.searchParams.get('season'));
	const episode = Number(url.searchParams.get('episode'));

	if (!mediaId || !Number.isInteger(season) || !Number.isInteger(episode)) {
		error(400, 'mediaId, season and episode are required');
	}

	try {
		return json(await getEpisode(source, mediaId, season, episode));
	} catch (err) {
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable.');
		if (err instanceof FloppyError) error(err.status === 404 ? 404 : 502, err.message);
		throw err;
	}
};
