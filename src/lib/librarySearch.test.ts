import { describe, it, expect } from 'vitest';
import { fold, searchLibrary, type LibraryTitle } from './librarySearch';

const t = (title: string, status = 1, mediaType: 'tv' | 'movie' = 'tv'): LibraryTitle => ({ mediaType, mediaId: title, title, poster: null, status, year: null });
const lib = [
	t('Re:ZERO -Starting Life in Another World-'),
	t('The Great British Bake Off', 3),
	t('Below Deck Mediterranean'),
	t('Below Deck', 4),
	t('Murder Below Deck', 0),
	t('Pokémon', 3),
	t('Zero Dark Thirty', 3, 'movie')
];
const titles = (q: string) => searchLibrary(lib, q).map((r) => r.title);

describe('searching your library', () => {
	it('ignores case, punctuation, accents and a leading "the"', () => {
		expect(fold('The Great British Bake Off')).toBe('greatbritishbakeoff');
		expect(titles('rezero')).toEqual(['Re:ZERO -Starting Life in Another World-']);
		expect(titles('re zero')).toEqual(['Re:ZERO -Starting Life in Another World-']);
		expect(titles('pokemon')).toEqual(['Pokémon']);
		expect(titles('great british')).toEqual(['The Great British Bake Off']);
	});

	it('titles that start with it first, then what you are watching, then A–Z; films too', () => {
		expect(titles('below deck')).toEqual(['Below Deck Mediterranean', 'Below Deck', 'Murder Below Deck']);
		expect(titles('zero')).toEqual(['Zero Dark Thirty', 'Re:ZERO -Starting Life in Another World-']);
	});

	it('nothing for an empty query', () => {
		expect(titles('  ')).toEqual([]);
	});
});
