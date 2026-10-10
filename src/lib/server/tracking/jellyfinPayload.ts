/**
 * Jellyfin's webhook, read so the template already set up in Jellyfin works
 * as-is (own-tracking plan, step 4). Pure: the
 * payload in, what it means out.
 */

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown) => {
	const n = typeof v === 'string' ? Number(v) : v;
	return typeof n === 'number' && Number.isInteger(n) ? n : null;
};

export type JellyfinEvent =
	| { action: 'ignore'; reason: string }
	| {
			action: 'play' | 'unplay';
			kind: 'tv' | 'movie';
			/** From the TMDB link or ProviderIds: the show (episodes) or film. */
			tmdbId: number | null;
			/** Jellyfin's own numbering — may be an alternate order (Re:Zero S4E17). */
			season: number | null;
			episode: number | null;
			/** The episode's (or film's) own ids, for TMDB /find. */
			imdbId: string | null;
			tvdbId: number | null;
			title: string;
			/** When it was played, if Jellyfin says; else now. */
			playedAt: string | null;
			event: string;
	  };

/** Ticks are 100 ns. */
const seconds = (ticks: unknown) => {
	const t = typeof ticks === 'number' ? ticks : Number(ticks);
	return Number.isFinite(t) && t >= 0 ? Math.floor(t / 10_000_000) : null;
};

function tmdbFromUrls(item: Raw): { show: number | null; movie: number | null } {
	for (const u of Array.isArray(item.ExternalUrls) ? item.ExternalUrls : []) {
		const url = str(rec(u).Url) ?? '';
		const tv = url.match(/themoviedb\.org\/tv\/(\d+)/);
		if (tv) return { show: Number(tv[1]), movie: null };
		const mv = url.match(/themoviedb\.org\/movie\/(\d+)/);
		if (mv) return { show: null, movie: Number(mv[1]) };
	}
	return { show: null, movie: null };
}

/** What a webhook call means: a play, an unplay, or nothing to do. */
export function readJellyfin(payload: unknown): JellyfinEvent {
	const p = rec(payload);
	let event = str(p.Event) ?? '';
	const item = rec(p.Item);
	const userData = rec(item.UserData);

	// The checkmark in Jellyfin arrives as UserDataSaved with SaveReason TogglePlayed.
	if (event === 'UserDataSaved') {
		if (p.SaveReason !== 'TogglePlayed') return { action: 'ignore', reason: 'progress save' };
		event = userData.Played === true ? 'MarkPlayed' : userData.Played === false ? 'MarkUnplayed' : '';
	}

	let action: 'play' | 'unplay';
	if (event === 'MarkPlayed') action = 'play';
	else if (event === 'MarkUnplayed') action = 'unplay';
	else if (event === 'Stop') {
		const pos = seconds(p.PlaybackPositionTicks ?? item.PlaybackPositionTicks);
		const dur = seconds(item.RunTimeTicks);
		const finished = userData.Played === true || (pos !== null && dur !== null && dur > 0 && pos * 5 >= dur * 4);
		if (!finished) return { action: 'ignore', reason: 'stopped before the end' };
		action = 'play';
	} else return { action: 'ignore', reason: `event ${event || 'none'}` };

	const type = str(item.Type);
	if (type !== 'Episode' && type !== 'Movie') return { action: 'ignore', reason: `item type ${type ?? 'none'}` };
	const kind = type === 'Movie' ? 'movie' : 'tv';
	const ids = rec(item.ProviderIds);
	const urls = tmdbFromUrls(item);
	const tmdbProvider = int(ids.Tmdb);
	const name = str(item.Name) ?? '';
	const series = str(item.SeriesName);
	const season = int(item.ParentIndexNumber);
	const episode = int(item.IndexNumber);

	return {
		action,
		kind,
		// For an episode, ProviderIds.Tmdb is the *episode's* id — the show comes from the link.
		tmdbId: kind === 'movie' ? (tmdbProvider ?? urls.movie) : urls.show,
		season: kind === 'tv' ? season : null,
		episode: kind === 'tv' ? episode : null,
		imdbId: str(ids.Imdb),
		tvdbId: int(ids.Tvdb),
		title: kind === 'tv' && series ? `${series} S${season ?? '?'}E${episode ?? '?'}` : name,
		playedAt: action === 'play' ? str(userData.LastPlayedDate) : null,
		event
	};
}
