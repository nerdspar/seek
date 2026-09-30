import { json } from '@sveltejs/kit';
import { syncAnimeTags } from '$lib/server/anime-sync';
import type { RequestHandler } from './$types';

/**
 * Reconcile the Floppy `anime` tag to Jellyfin's Anime library on demand — the
 * same job the scheduler runs, exposed so it can be triggered after moving shows
 * in Floppy without waiting for the next tick. Gated by the session check in
 * hooks.server.ts (a no-session caller gets 401).
 */
export const POST: RequestHandler = async () => {
	const result = await syncAnimeTags();
	return json(result);
};
