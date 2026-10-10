/**
 * The watchlist's last-episode slide-off: the row slides out the moment you
 * mark, and the server says whether there's another aired episode to come back
 * with. The two can finish in either order — Seek usually answers before the
 * slide ends — and the answer must win whichever lands first.
 */
export type Finishing = {
	/** The server answered: does the row stay (another aired episode, or unknown)? */
	answered(key: string, stays: boolean): void;
	/** The slide-off finished: 'keep' (slide it back) or 'remove'. */
	slid(key: string): 'keep' | 'remove';
};

export function finishing(): Finishing {
	const staying = new Set<string>();
	return {
		answered(key, stays) {
			if (stays) staying.add(key);
			else staying.delete(key);
		},
		slid(key) {
			if (!staying.has(key)) return 'remove';
			staying.delete(key);
			return 'keep';
		}
	};
}
