import { json } from '@sveltejs/kit';
import { syncAnimeTags } from '$lib/server/anime-sync';
import type { RequestHandler } from './$types';

/**
 * Reconcile your Floppy `anime` tags to what's anime (Floppy's "Anime" genre,
 * plus the household's overrides) on demand — the same job the scheduler runs, without waiting for the
 * next tick. Gated by the session check in
 * hooks.server.ts (a no-session caller gets 401).
 */
export const POST: RequestHandler = async () => {
	const result = await syncAnimeTags();
	return json(result);
};
