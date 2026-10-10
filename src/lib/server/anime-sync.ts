/**
 * What's anime: Seek's rule over its TMDB copy (tracking/anime.ts), with the
 * household's own answer winning wherever it disagrees. Worked out as the lists
 * are read, so there's nothing to keep in step.
 */
import { db, nowIso } from './db';
import { animeByCatalog } from './tracking/anime';

/** The household's own answers, where it disagrees with TMDB. */
export function animeOverrides(householdId: number): Map<string, boolean> {
	const rows = db()
		.prepare('SELECT media_id, is_anime FROM anime_overrides WHERE household_id = ? AND source = ?')
		.all(householdId, 'tmdb') as { media_id: string; is_anime: number }[];
	return new Map(rows.map((r) => [r.media_id, r.is_anime === 1]));
}

/** Overrule TMDB for one show (null: go back to TMDB's answer). */
export function setAnimeOverride(householdId: number, userId: number, tmdbId: string, isAnime: boolean | null): void {
	if (isAnime === null) {
		db()
			.prepare('DELETE FROM anime_overrides WHERE household_id = ? AND source = ? AND media_id = ?')
			.run(householdId, 'tmdb', tmdbId);
		return;
	}
	db()
		.prepare(
			`INSERT INTO anime_overrides (household_id, source, media_id, is_anime, user_id, created_at)
			 VALUES (?, 'tmdb', ?, ?, ?, ?)
			 ON CONFLICT (household_id, source, media_id) DO UPDATE SET is_anime = excluded.is_anime, user_id = excluded.user_id`
		)
		.run(householdId, tmdbId, isAnime ? 1 : 0, userId, nowIso());
}

const list = (v: unknown): string[] => {
	try {
		const a = JSON.parse(String(v ?? '[]'));
		return Array.isArray(a) ? a : [];
	} catch {
		return [];
	}
};

/** Whether one show counts as anime for this household. */
export function isAnime(householdId: number, tmdbId: string): boolean {
	const o = animeOverrides(householdId);
	if (o.has(tmdbId)) return o.get(tmdbId)!;
	const t = db()
		.prepare("SELECT genres, origin_country, original_language, keywords FROM titles WHERE media_type = 'tv' AND tmdb_id = ?")
		.get(Number(tmdbId)) as Record<string, unknown> | undefined;
	if (!t) return false;
	return animeByCatalog({
		genres: list(t.genres),
		originCountry: list(t.origin_country),
		originalLanguage: typeof t.original_language === 'string' ? t.original_language : null,
		keywords: list(t.keywords)
	});
}
