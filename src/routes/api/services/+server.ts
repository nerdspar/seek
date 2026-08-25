import { json } from '@sveltejs/kit';
import { knownServices } from '$lib/server/watchlist';
import { memo } from '$lib/server/memo';
import type { RequestHandler } from './$types';

/**
 * Streaming services seen across the library, for the settings picker and the
 * filter sheet.
 *
 * Its own endpoint because building it pages the whole library — expensive
 * enough that awaiting it in the Profile load blocked that page for 11s on a
 * cold cache, for data only the settings sheet ever reads.
 */
export const GET: RequestHandler = async () =>
	json({ services: await memo('services:all', 6 * 60 * 60 * 1000, knownServices) });
