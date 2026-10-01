import { describe, it, expect } from 'vitest';
import { pullOffset, PULL_THRESHOLD } from './pullToRefresh';

describe('pullOffset', () => {
	it('is 0 for no pull or an upward drag', () => {
		expect(pullOffset(0)).toBe(0);
		expect(pullOffset(-40)).toBe(0);
	});
	it('halves the drag (resistance)', () => {
		expect(pullOffset(40)).toBe(20);
		expect(pullOffset(100)).toBe(50);
	});
	it('caps the pull so it cannot run away', () => {
		expect(pullOffset(10_000)).toBe(96);
	});
	it('a drag past ~2x the threshold reaches the cap', () => {
		expect(pullOffset(PULL_THRESHOLD * 2 + 10)).toBeGreaterThanOrEqual(PULL_THRESHOLD);
	});
});
