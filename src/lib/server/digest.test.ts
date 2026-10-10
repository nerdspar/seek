import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import type { UpcomingItem } from '$lib/types';

let items: UpcomingItem[] = [];
vi.mock('./upcoming', () => ({ getUpcoming: async () => items }));
vi.mock('./push', () => ({}));

import { buildTodayDigest } from './digest';

/* Lanterns S1E8: a date with no time, Sunday Oct 4 (as Upcoming gives it). */
const lanterns = (): UpcomingItem => ({
	title: 'Lanterns',
	season: 1,
	episode: 8,
	start: '2026-10-04T12:00:00.000Z',
	hasTime: false,
	poster: null,
	mediaId: '1',
	source: 'tmdb',
	mediaType: 'tv'
});

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
