/** Seek's copy of show and movie info, in its own database (migration v12). */
import { db } from '../db';
import type { EpisodeRow, MediaType, TitleRow } from './map';

const iso = (ms: number) => new Date(ms).toISOString();

/** Make sure a title is known, due at once if new. Returns whether it was added. */
export function ensureTitle(mediaType: MediaType, tmdbId: number): boolean {
	const r = db()
		.prepare('INSERT OR IGNORE INTO titles (media_type, tmdb_id, refresh_after) VALUES (?, ?, ?)')
		.run(mediaType, tmdbId, iso(0));
	return r.changes > 0;
}

/** Save a refreshed title, and replace the seasons that were fetched. */
export function saveTitle(t: TitleRow, seasons: Map<number, EpisodeRow[]>, tvmazeId: number | null, refreshedAt: number, dueAt: number): void {
	const d = db();
	d.transaction(() => {
		d.prepare(
			`INSERT INTO titles (media_type, tmdb_id, title, poster, backdrop, status, genres, networks, runtime,
				origin_country, original_language, release_date, last_air_date, next_air_date, tvdb_id, imdb_id,
				tvmaze_id, refreshed_at, refresh_after, last_error, services, keywords)
			VALUES (@mediaType, @tmdbId, @title, @poster, @backdrop, @status, @genres, @networks, @runtime,
				@originCountry, @originalLanguage, @releaseDate, @lastAirDate, @nextAirDate, @tvdbId, @imdbId,
				@tvmazeId, @refreshedAt, @refreshAfter, NULL, @services, @keywords)
			ON CONFLICT (media_type, tmdb_id) DO UPDATE SET
				title = excluded.title, poster = excluded.poster, backdrop = excluded.backdrop, status = excluded.status,
				genres = excluded.genres, networks = excluded.networks, runtime = excluded.runtime,
				origin_country = excluded.origin_country, original_language = excluded.original_language,
				release_date = excluded.release_date, last_air_date = excluded.last_air_date,
				next_air_date = excluded.next_air_date, tvdb_id = excluded.tvdb_id, imdb_id = excluded.imdb_id,
				tvmaze_id = COALESCE(excluded.tvmaze_id, titles.tvmaze_id), refreshed_at = excluded.refreshed_at,
				refresh_after = excluded.refresh_after, last_error = NULL, services = excluded.services,
				keywords = excluded.keywords`
		).run({
			...t,
			genres: JSON.stringify(t.genres),
			networks: JSON.stringify(t.networks),
			originCountry: JSON.stringify(t.originCountry),
			services: JSON.stringify(t.services),
			keywords: JSON.stringify(t.keywords),
			tvmazeId,
			refreshedAt: iso(refreshedAt),
			refreshAfter: iso(dueAt)
		});
		const del = d.prepare('DELETE FROM episodes WHERE tmdb_id = ? AND season = ?');
		const ins = d.prepare(
			`INSERT INTO episodes (tmdb_id, season, episode, title, overview, still, air_date, air_at, runtime)
			VALUES (@tmdbId, @season, @episode, @title, @overview, @still, @airDate, @airAt, @runtime)`
		);
		for (const [season, rows] of seasons) {
			del.run(t.tmdbId, season);
			for (const r of rows) ins.run(r);
		}
	})();
}

/** A refresh failed: note why, and try again later. */
export function noteFailure(mediaType: MediaType, tmdbId: number, error: string, retryAt: number): void {
	db()
		.prepare('UPDATE titles SET last_error = ?, refresh_after = ? WHERE media_type = ? AND tmdb_id = ?')
		.run(error.slice(0, 500), iso(retryAt), mediaType, tmdbId);
}

/** Episode count per stored season, to tell which seasons changed. */
export function storedSeasonCounts(tmdbId: number): Map<number, number> {
	const rows = db()
		.prepare('SELECT season, COUNT(*) AS n FROM episodes WHERE tmdb_id = ? GROUP BY season')
		.all(tmdbId) as { season: number; n: number }[];
	return new Map(rows.map((r) => [r.season, r.n]));
}

export function storedTvmazeId(tmdbId: number): number | null {
	const r = db().prepare("SELECT tvmaze_id FROM titles WHERE media_type = 'tv' AND tmdb_id = ?").get(tmdbId) as
		| { tvmaze_id: number | null }
		| undefined;
	return r?.tvmaze_id ?? null;
}

/** Titles due for a refresh, most overdue first. */
export function dueTitles(now: number, limit: number): { mediaType: MediaType; tmdbId: number }[] {
	return (
		db()
			.prepare('SELECT media_type, tmdb_id FROM titles WHERE refresh_after <= ? ORDER BY refresh_after LIMIT ?')
			.all(iso(now), limit) as { media_type: MediaType; tmdb_id: number }[]
	).map((r) => ({ mediaType: r.media_type, tmdbId: r.tmdb_id }));
}

export type CatalogStatus = {
	shows: number;
	movies: number;
	filled: number;
	episodes: number;
	withAirTimes: number;
	due: number;
	failing: { mediaType: MediaType; tmdbId: number; title: string; error: string }[];
};

/** How full and how fresh the copy is (Settings, and checking step 1). */
export function catalogStatus(now: number): CatalogStatus {
	const d = db();
	const count = (sql: string, ...args: unknown[]) => (d.prepare(sql).get(...args) as { n: number }).n;
	return {
		shows: count("SELECT COUNT(*) AS n FROM titles WHERE media_type = 'tv'"),
		movies: count("SELECT COUNT(*) AS n FROM titles WHERE media_type = 'movie'"),
		filled: count('SELECT COUNT(*) AS n FROM titles WHERE refreshed_at IS NOT NULL'),
		episodes: count('SELECT COUNT(*) AS n FROM episodes'),
		withAirTimes: count('SELECT COUNT(*) AS n FROM episodes WHERE air_at IS NOT NULL'),
		due: count('SELECT COUNT(*) AS n FROM titles WHERE refresh_after <= ?', iso(now)),
		failing: (
			d.prepare('SELECT media_type, tmdb_id, title, last_error FROM titles WHERE last_error IS NOT NULL LIMIT 20').all() as {
				media_type: MediaType;
				tmdb_id: number;
				title: string;
				last_error: string;
			}[]
		).map((r) => ({ mediaType: r.media_type, tmdbId: r.tmdb_id, title: r.title, error: r.last_error }))
	};
}
