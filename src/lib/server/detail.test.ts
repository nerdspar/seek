import { describe, it, expect } from 'vitest';
import { shouldDeriveProgress } from './detail';

describe('shouldDeriveProgress', () => {
	it('is false for a normal show whose seasons already sum to the total', () => {
		expect(shouldDeriveProgress(30, [10, 10, 10])).toBe(false);
	});
	it('is true for a grouped show whose per-season progress is null (Re:ZERO)', () => {
		// Show reports 83 watched but every season summary is null.
		expect(shouldDeriveProgress(83, [null, null])).toBe(true);
	});
	it('is true when the seasons undercount the show total', () => {
		expect(shouldDeriveProgress(25, [10, null])).toBe(true);
	});
	it('does not derive when nothing is watched', () => {
		expect(shouldDeriveProgress(0, [null, null])).toBe(false);
		expect(shouldDeriveProgress(0, [0, 0])).toBe(false);
	});
});
