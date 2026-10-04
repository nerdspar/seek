import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseIcal } from './ical';
import { dayKey } from '$lib/format';

const feed = (dtstart: string) =>
	['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:x', 'SUMMARY:Lanterns S1 E8', dtstart, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

let tz: string | undefined;
beforeAll(() => {
	tz = process.env.TZ;
	process.env.TZ = 'America/New_York';
});
afterAll(() => {
	process.env.TZ = tz;
});

describe('parseIcal dates', () => {
	it('keeps an all-day episode on its own date west of UTC (Lanterns S1E8 is a Sunday)', () => {
		const [e] = parseIcal(feed('DTSTART;VALUE=DATE:20261004'));
		expect(e.hasTime).toBe(false);
		// Midnight UTC would be Saturday 8pm in New York — a day early.
		expect(dayKey(e.start)).toBe('2026-10-04');
		expect(e.start.slice(0, 10)).toBe('2026-10-04');
	});

	it('keeps a real air time as the instant it is', () => {
		const [e] = parseIcal(feed('DTSTART:20261005T010000Z'));
		expect(e).toMatchObject({ hasTime: true, start: '2026-10-05T01:00:00.000Z' });
	});
});
