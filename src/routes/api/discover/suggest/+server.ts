import { json } from '@sveltejs/kit';
import { searchKeywords, searchPeople, tmdbConfigured } from '$lib/server/tmdb';
import type { RequestHandler } from './$types';

/** Autocomplete for the Discover filter's tag field: TMDB keywords (tags) and
 *  people (actors/directors), so "heist" and "Nick Offerman" both resolve. */
export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	if (!q || !tmdbConfigured()) return json({ keywords: [], people: [] });
	const [keywords, people] = await Promise.all([searchKeywords(q), searchPeople(q)]);
	return json({ keywords, people });
};
