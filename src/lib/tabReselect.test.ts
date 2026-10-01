import { describe, it, expect } from 'vitest';
import { reselectTop, scrollAt } from './tabReselect';

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

describe('scrollAt (easeOutCubic tween)', () => {
	it('starts at `from` and ends at `to`', () => {
		expect(scrollAt(100, 900, 0)).toBe(100);
		expect(scrollAt(100, 900, 1)).toBe(900);
	});
	it('clamps progress outside [0,1]', () => {
		expect(scrollAt(100, 900, -0.5)).toBe(100);
		expect(scrollAt(100, 900, 2)).toBe(900);
	});
	it('stays put when there is nowhere to go', () => {
		expect(scrollAt(300, 300, 0)).toBe(300);
		expect(scrollAt(300, 300, 0.5)).toBe(300);
		expect(scrollAt(300, 300, 1)).toBe(300);
	});
	it('eases out — past the halfway point by the time progress is half', () => {
		const mid = scrollAt(0, 1000, 0.5);
		expect(mid).toBeGreaterThan(500); // decelerating, so already past linear
		expect(mid).toBeLessThan(1000);
	});
	it('is monotonic across the tween', () => {
		let prev = -Infinity;
		for (let t = 0; t <= 1.0001; t += 0.1) {
			const v = scrollAt(0, 1000, t);
			expect(v).toBeGreaterThanOrEqual(prev);
			prev = v;
		}
	});
});
