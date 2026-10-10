import { describe, it, expect } from 'vitest';
import { closesOnBlur, closesOnScroll } from './searchBar';

describe('the watchlist search box gets out of the way', () => {
	it('an empty box goes once the list scrolls a little, not on a nudge', () => {
		expect(closesOnScroll(true, '', 0, 30)).toBe(false);
		expect(closesOnScroll(true, '', 0, 60)).toBe(true);
		expect(closesOnScroll(true, '  ', 200, 120)).toBe(true);
	});
	it('a box with something typed stays while you scroll the results', () => {
		expect(closesOnScroll(true, 'bake', 0, 600)).toBe(false);
		expect(closesOnBlur(true, 'bake')).toBe(false);
	});
	it('tapping away from an empty box closes it; a closed box stays closed', () => {
		expect(closesOnBlur(true, '')).toBe(true);
		expect(closesOnBlur(false, '')).toBe(false);
		expect(closesOnScroll(false, '', 0, 900)).toBe(false);
	});
});
