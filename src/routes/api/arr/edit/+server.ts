import { json, error } from '@sveltejs/kit';
import { editSeries, editMovie, type SeriesEdit, type MovieEdit } from '$lib/server/arr';
import { serviceFor, requireConfigured, requireManage, arrFail } from '$lib/server/arrRoute';
import type { RequestHandler } from './$types';

type Body = {
	mediaType?: string;
	tmdbId?: string | number;
	monitored?: boolean;
	qualityProfileId?: number;
	rootFolderPath?: string;
	seriesType?: string;
	seasonFolder?: boolean;
	minimumAvailability?: string;
	tags?: string[];
};

/** Edit a monitored title's settings. Only the fields present in the body change;
 *  the rest of the series/movie object is preserved (a partial PUT half-tracks). */
export const PUT: RequestHandler = async ({ request }) => {
	await requireManage();
	const body = (await request.json().catch(() => ({}))) as Body;
	const tmdbId = body.tmdbId != null ? String(body.tmdbId) : '';
	if (!tmdbId) error(400, 'tmdbId is required');

	const service = serviceFor(body.mediaType);
	requireConfigured(service);
	try {
		if (service === 'radarr') {
			const edit: MovieEdit = {
				monitored: body.monitored,
				qualityProfileId: body.qualityProfileId,
				rootFolderPath: body.rootFolderPath,
				minimumAvailability: body.minimumAvailability,
				tags: body.tags
			};
			return json({ movie: await editMovie(tmdbId, edit) });
		}
		const edit: SeriesEdit = {
			monitored: body.monitored,
			qualityProfileId: body.qualityProfileId,
			rootFolderPath: body.rootFolderPath,
			seriesType: body.seriesType,
			seasonFolder: body.seasonFolder,
			tags: body.tags
		};
		return json({ series: await editSeries(tmdbId, edit) });
	} catch (err) {
		arrFail(err, service);
	}
};
