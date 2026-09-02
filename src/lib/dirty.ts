/**
 * A one-bit note that the watchlist is out of date.
 *
 * SvelteKit reuses cached page data for back/forward navigation: returning to
 * the list after marking an episode re-renders the copy it already had, so the
 * row still showed the episode you had just finished. The server was right the
 * whole time — nothing asked it.
 *
 * Deliberately not a rune: this is read once, imperatively, in `afterNavigate`.
 * A plain module variable also keeps this importable from a `.ts` file, which
 * `$state` would not be.
 */
let dirty = false;

/** Called by anything that writes state the watchlist displays. */
export function touchWatchlist(): void {
	dirty = true;
}

/** True once per write, so an unchanged return navigation costs nothing. */
export function consumeWatchlist(): boolean {
	const was = dirty;
	dirty = false;
	return was;
}
