/**
 * Adding a title to someone's list, with its show info fetched on the spot so
 * it's on the watchlist — episodes, next-up and all — the moment it's added.
 */
import { db } from '../db';
import { ensureTitle } from '../catalog/store';
import { refreshTitle } from '../catalog/refresh';
import { ensureTracked, type Kind } from './write';

/** Track it (as Planning) unless already tracked. Returns whether it already was. */
export async function addTitle(userId: number, kind: Kind, tmdbId: number): Promise<{ already: boolean }> {
	const already = Boolean(db().prepare('SELECT 1 FROM tracked WHERE user_id = ? AND media_type = ? AND tmdb_id = ?').get(userId, kind, tmdbId));
	ensureTracked(userId, kind, tmdbId);
	ensureTitle(kind, tmdbId);
	const filled = db().prepare('SELECT 1 FROM titles WHERE media_type = ? AND tmdb_id = ? AND refreshed_at IS NOT NULL').get(kind, tmdbId);
	if (!filled) await refreshTitle(kind, tmdbId, 0).catch((err) => console.warn(`[tracking] fetching ${kind} ${tmdbId} failed:`, err));
	return { already };
}
