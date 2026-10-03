/**
 * What Seek is for, per person (Settings → Shows, movies & books): which of
 * the three kinds are on. Client-safe; pages use it to hide segments, rows and
 * filters, and to land somewhere that's on.
 */
export type MediaKind = 'tv' | 'movie' | 'book';
export type MediaOn = Record<MediaKind, boolean>;

export function mediaOn(
	prefs: { showsEnabled?: boolean; moviesEnabled?: boolean; booksEnabled?: boolean },
	booksAvailable: boolean
): MediaOn {
	return {
		tv: prefs.showsEnabled !== false,
		movie: prefs.moviesEnabled !== false,
		book: prefs.booksEnabled !== false && booksAvailable
	};
}

/** Where to land: the kind asked for if it's on, else the first that is (shows,
 *  movies, books). Never nothing — prefs keep at least one on, and shows are the
 *  fallback if books are on but unavailable. */
export function landing(requested: MediaKind | null, on: MediaOn): MediaKind {
	if (requested && on[requested]) return requested;
	return on.tv ? 'tv' : on.movie ? 'movie' : on.book ? 'book' : 'tv';
}
