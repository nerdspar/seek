import { describe, it, expect } from 'vitest';
import { epLabel, hasRealAirTime, formatRuntime, relativeWhen, dayLabel } from './format';

describe('epLabel', () => {
	it('zero-pads season and episode', () => {
		expect(epLabel(1, 5)).toBe('S01E05');
		expect(epLabel(11, 17)).toBe('S11E17');
	});
});

describe('hasRealAirTime', () => {
	it('is false for a date-only value', () => {
		expect(hasRealAirTime('2026-06-08')).toBe(false);
	});
	it("is false for Floppy's 11:59:59 padding", () => {
		expect(hasRealAirTime('2026-06-08T11:59:59-04:00')).toBe(false);
	});
	it('is true for a genuine time', () => {
		expect(hasRealAirTime('2026-06-08T20:00:00-04:00')).toBe(true);
	});
});

describe('formatRuntime', () => {
	it('renders sub-hour as minutes', () => {
		expect(formatRuntime(42)).toBe('42 min');
	});
	it('renders whole and partial hours', () => {
		expect(formatRuntime(60)).toBe('1h');
		expect(formatRuntime(90)).toBe('1h 30m');
	});
});

describe('relativeWhen', () => {
	const from = new Date('2026-06-15T12:00:00Z');
	const at = (ms: number) => new Date(from.getTime() + ms).toISOString();
	it('returns empty for the past', () => {
		expect(relativeWhen(at(-60_000), from)).toBe('');
	});
	it('scales minutes → hours → days → weeks → months', () => {
		expect(relativeWhen(at(30 * 60_000), from)).toBe('30 Min');
		expect(relativeWhen(at(2 * 3_600_000), from)).toBe('2 Hours');
		expect(relativeWhen(at(1 * 3_600_000), from)).toBe('1 Hour');
		expect(relativeWhen(at(3 * 86_400_000), from)).toBe('3 Days');
		expect(relativeWhen(at(14 * 86_400_000), from)).toBe('2 Weeks');
		expect(relativeWhen(at(60 * 86_400_000), from)).toBe('2 Months');
	});
});

describe('dayLabel', () => {
	// Built the same way the function computes its own boundaries, so the branch
	// selection is asserted independently of the machine's timezone.
	const from = new Date('2026-06-15T12:00:00Z');
	const shift = (days: number) => {
		const d = new Date(from);
		d.setDate(d.getDate() + days);
		return d.toISOString();
	};
	it('labels today / tomorrow / yesterday', () => {
		expect(dayLabel(shift(0), from)).toBe('Today');
		expect(dayLabel(shift(1), from)).toBe('Tomorrow');
		expect(dayLabel(shift(-1), from)).toBe('Yesterday');
	});
	it('falls back to a formatted date further out', () => {
		const label = dayLabel(shift(10), from);
		expect(label).not.toBe('Today');
		expect(label).not.toBe('Tomorrow');
		expect(label).not.toBe('Yesterday');
		expect(label.length).toBeGreaterThan(0);
	});
});
