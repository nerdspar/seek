import { describe, it, expect } from 'vitest';
import {
	authorNames,
	normalizeProgress,
	mapReadingBook,
	mapHardcoverBook,
	mapHardcoverHit,
	mapHardcoverDetail,
	groupReading,
	statusLabel,
	normTitle,
	bookKey,
	coverThumb,
	readingSections,
	unownedWishes,
	cardBadge
} from './books';

describe('readingSections', () => {
	const owned = (id: number, status: string, title: string, author = 'A', hardcoverId: number | null = null) =>
		({ ...mapReadingBook({ id, title, authors: [author], readStatus: { status } }), hardcoverId });
	const wish = (hardcoverId: number, title: string, author = 'A') => ({
		hardcoverId,
		title,
		author,
		coverUrl: null,
		year: null,
		rating: null,
		addedAt: '2026-10-03T00:00:00Z'
	});

	it('folds wishlisted books into Want to read, even with no owned ones there', () => {
		const sections = readingSections([owned(1, 'reading', 'Dune')], [wish(50, 'Hyperion')]);
		expect(sections.map((s) => [s.title, s.books.length, s.wishes.map((w) => w.title)])).toEqual([
			['Reading', 1, []],
			['Want to read', 0, ['Hyperion']]
		]);
	});

	it('drops a wish once you own the book (by id or by title + author)', () => {
		const lib = [owned(1, 'unread', 'Hyperion', 'Dan Simmons'), owned(2, 'unread', 'Other', 'A', 77)];
		const left = unownedWishes([wish(50, 'Hyperion', 'Dan Simmons'), wish(77, 'Renamed'), wish(9, 'Still wanted')], lib);
		expect(left.map((w) => w.title)).toEqual(['Still wanted']);
	});
});

describe('cardBadge', () => {
	it('shows your status when owned, the wish otherwise, else nothing', () => {
		expect(cardBadge({ owned: { status: 'read' }, wished: true })).toBe('Read');
		expect(cardBadge({ owned: null, wished: true })).toBe('Want to read');
		expect(cardBadge({})).toBeNull();
	});
});

describe('coverThumb', () => {
	it('routes both cover sources through the thumbnailer at 2x', () => {
		expect(coverThumb('/api/books/cover/17', 52)).toBe('/api/books/cover/17?w=104');
		expect(coverThumb('https://assets.hardcover.app/edition/1/x.jpg', 110)).toBe(
			'/api/books/img?u=https%3A%2F%2Fassets.hardcover.app%2Fedition%2F1%2Fx.jpg&w=220'
		);
		expect(coverThumb('https://example.com/x.jpg', 110)).toBe('https://example.com/x.jpg');
		expect(coverThumb(null, 110)).toBeNull();
	});
});

describe('bookKey matching', () => {
	it('ignores case, punctuation, subtitles, series suffixes and leading articles', () => {
		expect(normTitle("14th Deadly Sin: (Women's Murder Club 14)")).toBe('14th deadly sin');
		expect(normTitle('The Hobbit, or There and Back Again')).toBe('hobbit or there and back again');
		expect(normTitle('Dune: Deluxe Edition')).toBe('dune');
		expect(bookKey('The Way of Kings', 'Brandon Sanderson')).toBe(bookKey('Way of Kings (Stormlight 1)', 'brandon  sanderson'));
	});
	it('keeps different books and different authors apart', () => {
		expect(bookKey('Dune', 'Frank Herbert')).not.toBe(bookKey('Dune Messiah', 'Frank Herbert'));
		expect(bookKey('Dune', 'Frank Herbert')).not.toBe(bookKey('Dune', 'Brian Herbert'));
	});
});

describe('groupReading', () => {
	const b = (id: number, status: string) => mapReadingBook({ id, title: `B${id}`, readStatus: { status } });
	it('sections the list in reading order, leaving out unread library books and empty sections', () => {
		const groups = groupReading([b(1, 'read'), b(2, 'reading'), b(3, 'unread'), b(4, 'rereading'), b(5, 'want_to_read')]);
		expect(groups.map((g) => [g.title, g.books.map((x) => x.id)])).toEqual([
			['Reading', [2, 4]],
			['Want to read', [5]],
			['Read', [1]]
		]);
	});
	it('labels statuses for people', () => {
		expect(statusLabel('abandoned')).toBe('Did not finish');
		expect(statusLabel('unread')).toBe('In your library');
	});
});

describe('mapHardcoverDetail', () => {
	it('adds description, deduped genres/moods and the series to the card', () => {
		const d = mapHardcoverDetail({
			id: 7,
			title: 'The Way of Kings',
			subtitle: null,
			description: 'Roshar is a world of stone and storms.',
			pages: 1007,
			rating: 4.6,
			ratings_count: 9000,
			users_count: 20000,
			release_year: 2010,
			image: { url: 'https://assets.hardcover.app/wok.jpg' },
			cached_contributors: [{ author: { name: 'Brandon Sanderson' }, primary: true }],
			cached_tags: {
				Genre: [{ tag: 'Fantasy' }, { tag: 'fantasy' }, { tag: 'Epic Fantasy' }],
				Mood: [{ tag: 'adventurous' }]
			},
			book_series: [{ position: 1, series: { name: 'The Stormlight Archive' } }]
		});
		expect(d).toMatchObject({
			hardcoverId: 7,
			author: 'Brandon Sanderson',
			description: 'Roshar is a world of stone and storms.',
			pages: 1007,
			readers: 20000,
			genres: ['Fantasy', 'Epic Fantasy'],
			moods: ['adventurous'],
			series: { name: 'The Stormlight Archive', position: 1 }
		});
	});

	it('copes with no tags and no series', () => {
		const d = mapHardcoverDetail({ id: 1, title: 'X' });
		expect(d.genres).toEqual([]);
		expect(d.series).toBeNull();
		expect(d.description).toBeNull();
	});
});

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
