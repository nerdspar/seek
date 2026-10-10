import { configured, notOnYourList, serverTitles, type ServerTitle } from './arr';
import { allTrackedIds } from './search';
import { memo } from './memo';

/**
 * Shows (Sonarr) or movies (Radarr) on the server that aren't on your list — someone else's, or added in Sonarr/Radarr directly. The shows side of
 * Books' "In my library": Discover offers them; your list stays yours.
 * Null when that service isn't set up. Short-lived: adding one from here drops
 * it (see /api/library).
 */
export function onServerNotListed(mediaType: 'tv' | 'movie'): Promise<ServerTitle[]> | null {
	const service = mediaType === 'tv' ? 'sonarr' : 'radarr';
	if (!configured(service)) return null;
	return memo(`onserver:${mediaType}`, 2 * 60 * 1000, async () => {
		const [titles, tracked] = await Promise.all([serverTitles(service), allTrackedIds(mediaType)]);
		return notOnYourList(titles, tracked);
	});
}
