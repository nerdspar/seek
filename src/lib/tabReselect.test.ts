import { describe, it, expect } from 'vitest';
import { reselectTop } from './tabReselect';

describe('reselectTop', () => {
	it('scrolls to the very top when there is no anchor', () => {
		expect(reselectTop(500, 0, null)).toBe(0);
		expect(reselectTop(0, 60, null)).toBe(0);
	});

	it('brings the anchor up to the container top', () => {
		// container top at 60, anchor 300px below it, already scrolled 200 → 500
		expect(reselectTop(200, 60, 360)).toBe(500);
	});

	it('is a no-op when the anchor already sits at the top', () => {
		expect(reselectTop(200, 60, 60)).toBe(200);
	});

	it('can scroll up (anchor above the current top)', () => {
		expect(reselectTop(500, 60, 10)).toBe(450);
	});
});
