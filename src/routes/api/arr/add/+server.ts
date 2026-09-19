import { json, error } from '@sveltejs/kit';
import {
	addTitle,
	configured,
	getOptions,
	ArrError,
	ArrUnreachable,
	type Service
} from '$lib/server/arr';
import { getPrefs } from '$lib/server/prefs';
import type { RequestHandler } from './$types';

type Body = {
	mediaType?: 'tv' | 'anime' | 'movie';
	tmdbId?: string | number;
	/** Kick off a search on add (start grabbing) vs. monitor only. Per add. */
	search?: boolean;
	monitored?: boolean;
};

/**
 * Add a title to Sonarr (TV/anime) or Radarr (movies) for monitoring.
 *
 * Root folder and quality profile come from the saved Settings choice; if none
 * has been made yet, the first of each the service offers is used, so the button
 * still works before anyone visits Settings.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	const tmdbId = body.tmdbId != null ? String(body.tmdbId) : '';
	if (!tmdbId) error(400, 'tmdbId is required');

	const service: Service = body.mediaType === 'movie' ? 'radarr' : 'sonarr';
	if (!configured(service)) {
		error(400, `${service === 'sonarr' ? 'Sonarr' : 'Radarr'} is not configured.`);
	}

	const prefs = await getPrefs();
	let choice = service === 'sonarr' ? prefs.sonarr : prefs.radarr;

	/* No saved choice yet: fall back to the first root folder and profile the
	   service offers, so a first-ever add does not require a Settings trip. */
	if (!choice) {
		const opts = await getOptions(service);
		const root = opts.rootFolders[0]?.path;
		const profile = opts.profiles[0]?.id;
		if (!root || profile === undefined) {
			error(400, `Pick a root folder and quality profile for ${service} in Settings first.`);
		}
		choice = { rootFolderPath: root, qualityProfileId: profile };
	}

	try {
		const result = await addTitle(service, tmdbId, {
			rootFolderPath: choice.rootFolderPath,
			qualityProfileId: choice.qualityProfileId,
			monitored: body.monitored ?? true,
			search: Boolean(body.search)
		});
		return json(result);
	} catch (err) {
		if (err instanceof ArrUnreachable) error(503, `${service} is unreachable; nothing was added.`);
		if (err instanceof ArrError) error(err.status === 404 ? 404 : 502, err.message);
		throw err;
	}
};
