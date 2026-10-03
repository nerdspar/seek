import { describe, it, expect } from 'vitest';
import {
	authorNames,
	normalizeProgress,
	mapReadingBook,
	mapHardcoverBook,
	mapHardcoverHit
} from './books';

describe('authorNames', () => {
	it('accepts plain strings (BookOrbit) and {name} objects', () => {
		expect(authorNames(['Andy Weir', 'X'])).toEqual(['Andy Weir', 'X']);
		expect(authorNames([{ name: 'George Orwell' }, { name: '' }])).toEqual(['George Orwell']);
	});
	it('returns [] for anything that is not an array', () => {
		expect(authorNames(null)).toEqual([]);
		expect(authorNames('Andy Weir')).toEqual([]);
	});
});

describe('normalizeProgress', () => {
	it('keeps fractions, converts percents, clamps', () => {
		expect(normalizeProgress(0.42)).toBe(0.42);
		expect(normalizeProgress(42)).toBe(0.42);
		expect(normalizeProgress(150)).toBe(1);
		expect(normalizeProgress(-3)).toBe(0);
	});
	it('is null when never opened or not a number', () => {
		expect(normalizeProgress(null)).toBeNull();
		expect(normalizeProgress('50')).toBeNull();
	});
});

describe('mapReadingBook', () => {
	// Shape of a live POST /books/query item (trimmed).
	const raw = {
		id: 17,
		title: 'Project Hail Mary',
		authors: ['Andy Weir'],
		readStatus: { status: 'reading', source: 'auto' },
		readingProgress: 0.35,
		rating: 4.5,
		pageCount: 476,
		publishedYear: 2021,
		seriesName: null,
		seriesIndex: null,
		hasCover: true,
		hardcoverId: 427578
	};

	it('maps the status, progress, authors and a Seek-proxied cover', () => {
		expect(mapReadingBook(raw)).toEqual({
			id: 17,
			title: 'Project Hail Mary',
			authors: ['Andy Weir'],
			status: 'reading',
			progress: 0.35,
			rating: 4.5,
			pageCount: 476,
			year: 2021,
			seriesName: null,
			seriesIndex: null,
			coverUrl: '/api/books/cover/17',
			hardcoverId: 427578
		});
	});

	it('treats a missing or unknown read status as unread', () => {
		expect(mapReadingBook({ ...raw, readStatus: null }).status).toBe('unread');
		expect(mapReadingBook({ ...raw, readStatus: { status: 'bogus' } }).status).toBe('unread');
	});

	it('has no cover URL when the book has no cover', () => {
		expect(mapReadingBook({ ...raw, hasCover: false }).coverUrl).toBeNull();
	});
});

describe('mapHardcoverBook', () => {
	it('takes the primary contributor as the author', () => {
		const card = mapHardcoverBook({
			id: 379760,
			title: '1984',
			rating: 4.25,
			release_year: 1949,
			image: { url: 'https://assets.hardcover.app/x.jpg' },
			cached_contributors: [
				{ author: { name: 'Peter Hobley Davison' }, primary: false },
				{ author: { name: 'George Orwell' }, primary: true }
			]
		});
		expect(card).toEqual({
			hardcoverId: 379760,
			title: '1984',
			author: 'George Orwell',
			coverUrl: 'https://assets.hardcover.app/x.jpg',
			year: 1949,
			rating: 4.25
		});
	});

	it('copes with no contributors and no image', () => {
		const card = mapHardcoverBook({ id: 1, title: 'Anon' });
		expect(card.author).toBeNull();
		expect(card.coverUrl).toBeNull();
	});
});

describe('mapHardcoverHit', () => {
	it('maps a search document (string id, author_names)', () => {
		expect(
			mapHardcoverHit({
				id: '427578',
				title: 'Project Hail Mary',
				author_names: ['Andy Weir'],
				image: { url: 'https://assets.hardcover.app/phm.jpg' },
				release_year: 2021,
				rating: 4.5
			})
		).toEqual({
			hardcoverId: 427578,
			title: 'Project Hail Mary',
			author: 'Andy Weir',
			coverUrl: 'https://assets.hardcover.app/phm.jpg',
			year: 2021,
			rating: 4.5
		});
	});
});
