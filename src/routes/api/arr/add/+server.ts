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
import { addMedia } from '$lib/server/search';
import { FloppyError } from '$lib/server/floppy';
import { expire, invalidate } from '$lib/server/memo';
import { settleAdded } from '$lib/server/household/run';
import { classifyShow } from '$lib/server/anime-sync';
import type { RequestHandler } from './$types';

type Body = {
	mediaType?: 'tv' | 'anime' | 'movie';
	tmdbId?: string | number;
	/** Per-add overrides; anything omitted falls back to the saved default. */
	rootFolderPath?: string;
	qualityProfileId?: number;
	monitor?: string;
	tags?: string[];
	/** Kick off a search on add (start grabbing) vs. monitor only. Per add. */
	search?: boolean;
	title?: string;
	/** Together or solo, when the add form asked (shows only). */
	together?: boolean;
};

/**
 * Add a title to Sonarr (TV/anime) or Radarr (movies) for monitoring.
 *
 * Root folder and quality profile come from the saved Settings choice; if none
 * has been made yet, the first of each the service offers is used, so the button
 * still works before anyone visits Settings.
 */
async function addToLibrary(mediaType: 'tv' | 'movie', tmdbId: string): Promise<boolean> {
	try {
		await addMedia(mediaType, 'tmdb', tmdbId);
	} catch (err) {
		if (!(err instanceof FloppyError && err.status === 409)) return false;
	}
	// The same caches /api/library refreshes when you add from Seek.
	expire('watchlist:');
	invalidate('tracked:');
	expire('discover:');
	invalidate('recent:');
	invalidate(`show:tmdb:${tmdbId}`);
	return true;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Body;
	const tmdbId = body.tmdbId != null ? String(body.tmdbId) : '';
	if (!tmdbId) error(400, 'tmdbId is required');

	const service: Service = body.mediaType === 'movie' ? 'radarr' : 'sonarr';
	if (!configured(service)) {
		error(400, `${service === 'sonarr' ? 'Sonarr' : 'Radarr'} is not configured.`);
	}

	const prefs = await getPrefs();
	const saved = service === 'sonarr' ? prefs.sonarr : prefs.radarr;

	/* Root folder and quality profile: the body's choice, else the saved default,
	   else the first the service offers — so a first-ever add still works without
	   a Settings trip. Monitor and tags fall back to the saved default and the
	   service-appropriate default inside addTitle. */
	let rootFolderPath = body.rootFolderPath ?? saved?.rootFolderPath;
	let qualityProfileId = body.qualityProfileId ?? saved?.qualityProfileId;
	if (!rootFolderPath || qualityProfileId === undefined) {
		const opts = await getOptions(service);
		rootFolderPath = rootFolderPath || opts.rootFolders[0]?.path;
		qualityProfileId = qualityProfileId ?? opts.profiles[0]?.id;
		if (!rootFolderPath || qualityProfileId === undefined) {
			error(400, `Pick a root folder and quality profile for ${service} in Settings first.`);
		}
	}

	try {
		const result = await addTitle(service, tmdbId, {
			rootFolderPath,
			qualityProfileId,
			monitor: body.monitor ?? saved?.monitor,
			tags: body.tags ?? saved?.tags ?? [],
			search: Boolean(body.search)
		});
		/* Downloading something means you mean to watch it: it goes into your
		   Floppy library too (Planning), like a book download goes on your list.
		   Already there is fine; a Floppy hiccup never fails the download. */
		const tracked = await addToLibrary(body.mediaType === 'movie' ? 'movie' : 'tv', tmdbId);
		const household =
			tracked && body.mediaType !== 'movie'
				? settleAdded(
						{ source: 'tmdb', mediaId: tmdbId, title: body.title ?? null },
						typeof body.together === 'boolean' ? (body.together ? 'together' : 'solo') : undefined
					)
				: null;
		if (tracked && body.mediaType !== 'movie') void classifyShow(tmdbId);
		return json({ ...result, tracked, household });
	} catch (err) {
		if (err instanceof ArrUnreachable) error(503, `${service} is unreachable; nothing was added.`);
		if (err instanceof ArrError) error(err.status === 404 ? 404 : 502, err.message);
		throw err;
	}
};
