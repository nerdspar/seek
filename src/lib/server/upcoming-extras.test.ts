import { describe, it, expect } from 'vitest';
import { filmReleases, authorsYouRead, windowAround } from './upcoming-extras';
import { myBooks, mapReadingBook } from '$lib/books';

describe('filmReleases', () => {
	it('takes the first wide theatrical and first digital date; skips premieres and disc', () => {
		expect(
			filmReleases([
				{ type: 1, release_date: '2026-07-14T00:00:00.000Z' },
				{ type: 3, release_date: '2026-07-17T00:00:00.000Z' },
				{ type: 3, release_date: '2026-08-01T00:00:00.000Z' },
				{ type: 4, release_date: '2026-11-17T00:00:00.000Z' },
				{ type: 5, release_date: '2026-11-17T00:00:00.000Z' }
			])
		).toEqual([
			{ what: 'In theaters', date: '2026-07-17T00:00:00.000Z' },
			{ what: 'On digital', date: '2026-11-17T00:00:00.000Z' }
		]);
	});

	it('falls back to a limited release, and copes with no dates', () => {
		expect(filmReleases([{ type: 2, release_date: '2026-12-01' }])).toEqual([{ what: 'In theaters', date: '2026-12-01' }]);
		expect(filmReleases([])).toEqual([]);
	});
});

describe('authorsYouRead', () => {
	it('lists the authors of what you finished or loved, once each', () => {
		const lib = [
			{ id: 1, title: 'A', authors: ['Andy Weir'], readStatus: { status: 'read' }, rating: 5 },
			{ id: 2, title: 'B', authors: ['Andy Weir'], readStatus: { status: 'read' } },
			{ id: 3, title: 'C', authors: ['N. K. Jemisin'], readStatus: { status: 'read' } },
			{ id: 4, title: 'D', authors: ['Unread Author'], readStatus: { status: 'unread' } }
		].map(mapReadingBook);
		expect(authorsYouRead(myBooks(lib, []))).toEqual(['Andy Weir', 'N. K. Jemisin']);
	});
});

describe('windowAround', () => {
	it('spans 30 days back to a year ahead', () => {
		const w = windowAround(Date.UTC(2026, 9, 3));
		expect(new Date(w.from).toISOString().slice(0, 10)).toBe('2026-09-03');
		expect(new Date(w.to).toISOString().slice(0, 10)).toBe('2027-10-03');
	});
});
