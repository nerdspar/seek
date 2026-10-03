import { describe, it, expect } from 'vitest';
import { mergeUpcoming, kindOf, kindsFiltered, ALL_KINDS } from './upcoming';
import type { UpcomingItem } from './types';

const item = (title: string, start: string, over: Partial<UpcomingItem> = {}): UpcomingItem => ({
	title,
	season: 1,
	episode: 1,
	start,
	hasTime: true,
	poster: null,
	mediaId: null,
	source: null,
	mediaType: 'tv',
	...over
});

describe('mergeUpcoming', () => {
	const cal = [
		item('Silo', '2026-10-05T01:00:00.000Z', { mediaId: '1' }),
		item('The Odyssey', '2026-11-17T00:00:00.000Z', { mediaId: '99', mediaType: 'movie', season: null, episode: null })
	];
	const extras = [
		item('The Odyssey', '2026-11-17T00:00:00.000Z', { mediaId: '99', mediaType: 'movie', kind: 'movie', note: 'On digital' }),
		item('Dune: In theaters', '2026-10-04T00:00:00.000Z', { mediaId: '7', mediaType: 'movie', kind: 'movie' }),
		item('Horneater', '2026-12-01T12:00:00.000Z', { kind: 'book', hardcoverId: 5 })
	];

	it('merges in time order without repeating a film the calendar has that day', () => {
		expect(mergeUpcoming(cal, extras).map((i) => i.title)).toEqual(['Dune: In theaters', 'Silo', 'The Odyssey', 'Horneater']);
	});

	it('filters by kind', () => {
		expect(mergeUpcoming(cal, extras, { tv: true, movie: false, book: false }).map((i) => i.title)).toEqual(['Silo']);
		expect(mergeUpcoming(cal, extras, { tv: false, movie: false, book: true }).map((i) => i.title)).toEqual(['Horneater']);
	});

	it('classifies rows, calendar films included', () => {
		expect(cal.map(kindOf)).toEqual(['tv', 'movie']);
		expect(kindOf(extras[2])).toBe('book');
		expect(kindsFiltered(ALL_KINDS)).toBe(false);
		expect(kindsFiltered({ ...ALL_KINDS, book: false })).toBe(true);
	});
});
