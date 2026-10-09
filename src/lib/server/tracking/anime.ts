/**
 * Anime or not, from Seek's own TMDB copy (own-tracking plan, step 5). TMDB has
 * no "Anime" genre, so: Animation, plus a Japanese/Chinese/Korean origin or
 * TMDB's "anime" keyword (Blood of Zeus, Ninja Kamui). Checked against the 42
 * shows tagged anime today: all 42 match, and no other animated show does
 * (Arcane, Invincible, Avatar, Star Wars…). The household's overrides win.
 */
const EAST_ASIA = new Set(['JP', 'CN', 'KR', 'TW']);
const LANGS = new Set(['ja', 'zh', 'ko', 'cn']);

export function animeByCatalog(t: { genres: string[]; originCountry: string[]; originalLanguage: string | null; keywords: string[] }): boolean {
	if (!t.genres.includes('Animation')) return false;
	return (
		t.originCountry.some((c) => EAST_ASIA.has(c)) ||
		(t.originalLanguage !== null && LANGS.has(t.originalLanguage)) ||
		t.keywords.some((k) => k.toLowerCase() === 'anime')
	);
}
