import { markTracked, withoutTracked } from '$lib/server/search';
import { json, error } from '@sveltejs/kit';
import { explore } from '$lib/server/explore';
import { tmdbConfigured } from '$lib/server/tmdb';
import type { RequestHandler } from './$types';

/** One box, every interpretation (§6.2). */
export const GET: RequestHandler = async ({ url }) => {
	if (!tmdbConfigured()) error(503, 'TMDB_API_KEY is not set — search is unavailable.');

	const q = url.searchParams.get('q')?.trim() ?? '';
	const mediaType = url.searchParams.get('type') === 'movie' ? 'movie' : 'tv';
	if (!q) return json({ sections: [] });

	try {
		/* Suggestions drop what you already have; a filmography marks it.
		   "Shows like The Office" is a discovery question and a tracked answer is
		   noise, but "what has this actor been in" is a lookup, and the show you
		   are trying to remember is quite likely one you already watched. */
		const sections = await Promise.all(
			(await explore(q, mediaType)).map(async (sec) =>
				sec.kind === 'person'
					? { ...sec, items: await markTracked(mediaType, sec.items) }
					: { ...sec, items: await withoutTracked(mediaType, sec.items) }
			)
		);
		return json({ sections: sections.filter((s) => s.items.length) });
	} catch (err) {
		error(502, err instanceof Error ? err.message : 'Search failed.');
	}
};
