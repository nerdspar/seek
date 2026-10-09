import { describe, it, expect } from 'vitest';
import { aired, nextUp, type Ep } from './nextUp';

const NOW = Date.parse('2026-10-09T22:00:00Z');
const season = (s: number, n: number, date = '2026-01-01', from = 1): Ep[] =>
	Array.from({ length: n }, (_, i) => ({ season: s, episode: from + i, airDate: date, airAt: null }));
const play = (s: number, e: number, at = '2026-02-01T00:00:00Z') => ({ season: s, episode: e, watchedAt: at });

describe('aired', () => {
	it('uses the real air time when known, else 00:00 UTC on the date', () => {
		expect(aired({ airDate: '2026-10-09', airAt: '2026-10-10T03:30:00Z' }, NOW)).toBe(false);
		expect(aired({ airDate: '2026-10-09', airAt: null }, NOW)).toBe(true);
		expect(aired({ airDate: '2026-10-10', airAt: null }, NOW)).toBe(false);
		expect(aired({ airDate: null, airAt: null }, NOW)).toBe(false);
	});
});

describe('nextUp', () => {
	it('a show you just added starts at the first aired episode (Avatar: Seven Havens)', () => {
		const eps = [...season(0, 2), ...season(1, 3, '2026-10-09'), ...season(1, 2, '2026-10-16', 4)];
		expect(nextUp(eps, [], NOW)).toEqual({ season: 1, episode: 1 });
		expect(nextUp(season(1, 3, '2026-11-01'), [], NOW)).toBeNull();
	});

	it('picks up after the highest episode you played in the season you are watching, not the first gap', () => {
		const eps = [...season(10, 20), ...season(11, 18)];
		// Below Deck Med: picked up mid-run in S10, now 17 into S11.
		const plays = [play(10, 15), play(10, 16), ...Array.from({ length: 17 }, (_, i) => play(11, i + 1, '2026-09-01T00:00:00Z'))];
		expect(nextUp(eps, plays, NOW)).toEqual({ season: 11, episode: 18 });
		// A skipped episode mid-season is left alone.
		expect(nextUp(season(1, 10), [play(1, 1), play(1, 5)], NOW)).toEqual({ season: 1, episode: 6 });
	});

	it("waits for episodes that haven't aired, then rolls into the next season", () => {
		const eps = [...season(1, 2), ...season(2, 2, '2026-12-01')];
		expect(nextUp(eps, [play(1, 1), play(1, 2)], NOW)).toBe('caught-up');
		const later = [...season(1, 2), ...season(2, 2, '2026-03-01')];
		expect(nextUp(later, [play(1, 1), play(1, 2)], NOW)).toEqual({ season: 2, episode: 1 });
	});

	it('goes by the season you played most recently, not the highest one (a dip back into an old season)', () => {
		const eps = [...season(1, 5), ...season(2, 5)];
		const plays = [play(2, 1, '2026-01-10T00:00:00Z'), play(1, 3, '2026-03-01T00:00:00Z')];
		expect(nextUp(eps, plays, NOW)).toEqual({ season: 1, episode: 4 });
	});

	it('ignores specials', () => {
		expect(nextUp([...season(0, 3), ...season(1, 2)], [play(0, 1)], NOW)).toEqual({ season: 1, episode: 1 });
	});
});
