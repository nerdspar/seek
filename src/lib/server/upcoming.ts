/**
 * Upcoming (§5): episodes of the shows you track, from Seek's TMDB copy with
 * TVmaze's air times (tracking/stats.ts `seekUpcoming`), 30 days back to a
 * year ahead.
 */
import { currentUser } from './userctx';
import { seekUpcoming } from './tracking/stats';
import type { UpcomingItem } from '$lib/types';

export async function getUpcoming(): Promise<UpcomingItem[]> {
	const me = currentUser();
	return me ? seekUpcoming(me.id) : [];
}
