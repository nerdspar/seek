import { describe, it, expect } from 'vitest';
import { finishing } from './finishing';

describe('last-episode slide-off', () => {
	it('an answer before the slide ends decides it: another episode keeps the row (Brothers E3 → E4)', () => {
		const f = finishing();
		f.answered('tv:250203', true);
		expect(f.slid('tv:250203')).toBe('keep');
	});

	it('caught up, or no answer yet: the row goes (a late "stays" brings it back separately)', () => {
		const f = finishing();
		f.answered('a', false);
		expect(f.slid('a')).toBe('remove');
		expect(f.slid('b')).toBe('remove');
	});

	it('an answer is used once, so a later mark of the same show starts fresh', () => {
		const f = finishing();
		f.answered('a', true);
		f.slid('a');
		expect(f.slid('a')).toBe('remove');
	});
});
