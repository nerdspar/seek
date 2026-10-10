/**
 * Cache warmup. Lists, pages and stats read Seek's own tables in milliseconds
 * and need none; what's left is Discover, which is a dozen TMDB calls cold.
 * Per person (its rows filter out what you track), one after another.
 */
import { getDiscoverRows } from './discover';
import { memo } from './memo';
import { currentUser, runAs } from './userctx';
import { forEachUser } from './scheduler';
import type { User } from './users';

/** Warm everything for the current user. */
export async function warmForCurrentUser(): Promise<void> {
	await memo('discover:tv', 30 * 60 * 1000, () => getDiscoverRows('tv')).catch((err) =>
		console.warn(`[seek] warmup discover failed for ${currentUser()?.name ?? '?'}:`, err)
	);
}

/** Warm every account, one after another. */
export const warmEveryone = () => forEachUser(() => warmForCurrentUser());

/** Warm one account in the background, e.g. right after they finish setup. */
export function warmInBackground(user: User): void {
	void runAs(user, () => warmForCurrentUser()).catch(() => {});
}
