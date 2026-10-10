import { json } from '@sveltejs/kit';
import { knownServices } from '$lib/server/watchlist';
import type { RequestHandler } from './$types';

/** Streaming services seen across what you track, for the settings picker and the filter sheet. */
export const GET: RequestHandler = async () => json({ services: await knownServices() });
