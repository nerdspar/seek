import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { parseIcal } from './ical';
import type { UpcomingItem } from '$lib/types';

let items: UpcomingItem[] = [];
vi.mock('./upcoming', () => ({ getUpcoming: async () => items }));
vi.mock('./push', () => ({}));

import { buildTodayDigest } from './digest';

/* What Floppy's feed says for Lanterns S1E8: an all-day event on Sunday Oct 4. */
const lanterns = (): UpcomingItem => {
	const [e] = parseIcal(
		['BEGIN:VEVENT', 'SUMMARY:Lanterns S1 E8', 'DTSTART;VALUE=DATE:20261004', 'END:VEVENT'].join('\r\n')
	);
	return { ...e, poster: null, mediaId: null, source: null, mediaType: 'tv' } as unknown as UpcomingItem;
};

let tz: string | undefined;
beforeAll(() => {
	tz = process.env.TZ;
	process.env.TZ = 'America/New_York';
});
afterAll(() => {
	process.env.TZ = tz;
});
afterEach(() => vi.useRealTimers());

describe('the morning digest', () => {
	it('does not announce a Sunday episode on Saturday morning', async () => {
		items = [lanterns()];
		vi.useFakeTimers({ now: new Date('2026-10-03T10:01:00-04:00') });
		expect(await buildTodayDigest()).toBeNull();
	});

	it('announces it on the day', async () => {
		items = [lanterns()];
		vi.useFakeTimers({ now: new Date('2026-10-04T10:01:00-04:00') });
		expect(await buildTodayDigest()).toMatchObject({ title: 'Airing today', body: 'Lanterns · S01E08' });
	});
});
