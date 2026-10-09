import { describe, it, expect } from 'vitest';
import { animeByCatalog } from './anime';

const t = (genres: string[], originCountry: string[], originalLanguage: string | null = null, keywords: string[] = []) => ({ genres, originCountry, originalLanguage, keywords });

describe('animeByCatalog', () => {
	it('is anime when animated and Japanese, Chinese or Korean, or keyworded "anime"', () => {
		expect(animeByCatalog(t(['Animation', 'Action & Adventure'], ['JP'], 'ja'))).toBe(true); // Re:ZERO
		expect(animeByCatalog(t(['Animation'], ['CN'], 'zh'))).toBe(true); // Lord of Mysteries
		expect(animeByCatalog(t(['Animation'], ['US'], 'en', ['anime', 'greek mythology']))).toBe(true); // Blood of Zeus
	});
	it('western animation and live action are not', () => {
		expect(animeByCatalog(t(['Animation', 'Drama'], ['US', 'FR'], 'en', ['steampunk']))).toBe(false); // Arcane
		expect(animeByCatalog(t(['Drama'], ['JP'], 'ja'))).toBe(false); // live-action Japanese drama
	});
});
