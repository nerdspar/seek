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
	myBooks,
	arrivedEntries,
	progressText,
	sortBooks,
	filterBooks,
	topGenres,
	bookFiltersActive,
	NO_BOOK_FILTERS,
	formatOf,
	cardBadge,
	type BookEntry,
	type MyBook,
	mapBookRequest,
	requestLabel,
	requestCancellable,
	requestFor
} from './books';

const owned = (id: number, status: string, title: string, author = 'A', hardcoverId: number | null = null, extra: Record<string, unknown> = {}) =>
	({ ...mapReadingBook({ id, title, authors: [author], readStatus: { status }, ...extra }), hardcoverId });
const entry = (hardcoverId: number, title: string, over: Partial<BookEntry> = {}): BookEntry => ({
	hardcoverId,
	title,
	author: 'A',
	coverUrl: null,
	year: null,
	rating: null,
	pages: null,
	status: 'want_to_read',
	myRating: null,
	progressPages: null,
	startedAt: null,
	finishedAt: null,
	addedAt: '2026-10-01T00:00:00Z',
	updatedAt: '2026-10-01T00:00:00Z',
	...over
});

describe('myBooks', () => {
	it('lists library books and your own entries together; a library copy supersedes your entry', () => {
		const lib = [owned(1, 'unread', 'Hyperion', 'Dan Simmons'), owned(2, 'reading', 'Dune', 'A', 77)];
		const list = myBooks(lib, [entry(50, 'Hyperion', { author: 'Dan Simmons' }), entry(77, 'Dune'), entry(9, 'Paper copy', { status: 'reading' })]);
		expect(list.map((b) => [b.key, b.source, b.status])).toEqual([
			['lib:1', 'library', 'unread'],
			['lib:2', 'library', 'reading'],
			['hc:9', 'entry', 'reading']
		]);
		expect(arrivedEntries([entry(50, 'Hyperion', { author: 'Dan Simmons' })], lib).map((a) => a.book.id)).toEqual([1]);
	});

	it("turns an entry's pages read into progress", () => {
		const [b] = myBooks([], [entry(9, 'X', { status: 'reading', pages: 400, progressPages: 124 })]);
		expect(b.progress).toBeCloseTo(0.31);
		expect(progressText(b)).toBe('124 / 400 pages · 31%');
		expect(progressText({ progress: 0.5, pages: null })).toBe('50%');
		expect(progressText({ progress: null, pages: 400 })).toBeNull();
	});
});

describe('readingSections', () => {
	const req = (id: number, status: string, hc: number | null) =>
		mapBookRequest({ id, status, title: `R${id}`, ...(hc ? { providerKey: 'hardcover', providerId: String(hc) } : {}) });

	it('groups by status; your own entries sit in their status like library books', () => {
		const books = myBooks([owned(1, 'reading', 'Dune')], [entry(50, 'Hyperion'), entry(51, 'Paper', { status: 'reading' })]);
		expect(readingSections(books).map((s) => [s.title, s.books.map((b) => b.title)])).toEqual([
			['Reading', ['Dune', 'Paper']],
			['Want to read', ['Hyperion']]
		]);
	});

	it('shows requests on the way after Reading, and takes those wants out of Want to read', () => {
		const books = myBooks([owned(1, 'reading', 'Dune')], [entry(50, 'Hyperion'), entry(51, 'Wanted')]);
		const sections = readingSections(books, [req(7, 'downloading', 50), req(8, 'pending', null), req(9, 'cancelled', 51)]);
		expect(sections.map((s) => [s.title, s.requests.map((r) => r.id), s.books.map((b) => b.title)])).toEqual([
			['Reading', [], ['Dune']],
			['Requested', [7, 8], []],
			['Want to read', [], ['Wanted']]
		]);
	});
});

describe('sorting and filtering', () => {
	const lib = [
		owned(1, 'reading', 'The Way of Kings', 'Brandon Sanderson', null, {
			readingProgress: 0.6,
			rating: 5,
			genres: ['Fantasy'],
			files: [{ format: 'epub' }],
			addedAt: '2026-01-01T00:00:00Z',
			readStatus: { status: 'reading', updatedAt: '2026-09-01T00:00:00Z' }
		}),
		owned(2, 'read', 'Dune', 'Frank Herbert', null, {
			rating: 3,
			genres: ['Science Fiction', 'Fantasy'],
			files: [{ format: 'm4b' }],
			addedAt: '2026-05-01T00:00:00Z',
			readStatus: { status: 'read', updatedAt: '2026-10-01T00:00:00Z' }
		}),
		owned(3, 'unread', 'A Wizard of Earthsea', 'Ursula K. Le Guin', null, { genres: ['fantasy'], addedAt: '2026-03-01T00:00:00Z' })
	];
	const books = myBooks(lib, [entry(9, 'Paper copy', { status: 'reading', updatedAt: '2026-08-01T00:00:00Z' })]);
	const titles = (bs: MyBook[]) => bs.map((b) => b.title);

	it('sorts every way the sheet offers, ignoring leading articles', () => {
		expect(titles(sortBooks(books, 'title'))).toEqual(['Dune', 'Paper copy', 'The Way of Kings', 'A Wizard of Earthsea']);
		expect(titles(sortBooks(books, 'active'))).toEqual(['Dune', 'The Way of Kings', 'Paper copy', 'A Wizard of Earthsea']);
		expect(titles(sortBooks(books, 'author'))[0]).toBe('Paper copy'); // "A"
		expect(titles(sortBooks(books, 'rating')).slice(0, 2)).toEqual(['The Way of Kings', 'Dune']);
		expect(titles(sortBooks(books, 'progress'))[0]).toBe('The Way of Kings');
		expect(titles(sortBooks(books, 'added'))[0]).toBe('Paper copy');
	});

	it('filters by status, kind, shelf and genre (case-insensitive)', () => {
		expect(titles(filterBooks(books, { ...NO_BOOK_FILTERS, status: 'reading' }))).toEqual(['The Way of Kings', 'Paper copy']);
		expect(titles(filterBooks(books, { ...NO_BOOK_FILTERS, status: 'unstarted' }))).toEqual(['A Wizard of Earthsea']);
		expect(titles(filterBooks(books, { ...NO_BOOK_FILTERS, kind: 'audiobook' }))).toEqual(['Dune']);
		expect(titles(filterBooks(books, { ...NO_BOOK_FILTERS, kind: 'mine' }))).toEqual(['Paper copy']);
		expect(titles(filterBooks(books, { ...NO_BOOK_FILTERS, shelf: 4 }, new Set([2, 3])))).toEqual(['Dune', 'A Wizard of Earthsea']);
		expect(titles(filterBooks(books, { ...NO_BOOK_FILTERS, genre: 'FANTASY' }))).toHaveLength(3);
		expect(bookFiltersActive(NO_BOOK_FILTERS)).toBe(false);
		expect(bookFiltersActive({ ...NO_BOOK_FILTERS, genre: 'x' })).toBe(true);
	});

	it('offers the most common genres first', () => {
		expect(topGenres(books)).toEqual(['Fantasy', 'Science Fiction']);
	});

	it('knows an audiobook file from an ebook one', () => {
		expect([formatOf('M4B'), formatOf('epub'), formatOf('cbz'), formatOf('pdf')]).toEqual(['audiobook', 'ebook', 'comic', 'ebook']);
	});
});

describe('cardBadge', () => {
	it('shows your library status when owned, your own status otherwise, else nothing', () => {
		expect(cardBadge({ owned: { status: 'read' }, mine: 'reading' })).toBe('Read');
		expect(cardBadge({ owned: null, mine: 'want_to_read' })).toBe('Want to read');
		expect(cardBadge({})).toBeNull();
	});
});

describe('mapBookRequest', () => {
	it('ties a request back to its Hardcover book and reads download progress', () => {
		const r = mapBookRequest({
			id: 4,
			status: 'downloading',
			title: 'Dune',
			authors: ['Frank Herbert'],
			providerKey: 'hardcover',
			providerId: '312460',
			mediaKind: 'audiobook',
			download: { progressPercent: 62.5, errorMessage: null },
			createdAt: '2026-10-01T00:00:00Z'
		});
		expect(r).toMatchObject({ id: 4, hardcoverId: 312460, author: 'Frank Herbert', mediaKind: 'audiobook', progress: 0.625 });
	});

	it('has no Hardcover id for requests made elsewhere, and keeps the reason', () => {
		const r = mapBookRequest({ id: 5, status: 'rejected', title: 'X', providerKey: 'openlibrary', providerId: 'OL1W', decisionNote: 'Already have it' });
		expect(r.hardcoverId).toBeNull();
		expect(r.reason).toBe('Already have it');
		expect(r.progress).toBeNull();
		expect(requestLabel(r.status)).toBe('Declined');
		expect(requestCancellable(r.status)).toBe(false);
		expect(requestCancellable('failed')).toBe(true);
	});

	it('picks the request worth showing for a book', () => {
		const req = (id: number, status: string, hc = 7) =>
			mapBookRequest({ id, status, providerKey: 'hardcover', providerId: String(hc) });
		expect(requestFor([req(1, 'cancelled'), req(2, 'downloading'), req(3, 'searching', 8)], 7)?.id).toBe(2);
		expect(requestFor([req(1, 'cancelled'), req(4, 'rejected')], 7)?.id).toBe(4);
		expect(requestFor([req(1, 'cancelled'), req(5, 'available')], 7)).toBeNull();
	});

	it('treats an unknown status as pending', () => {
		expect(mapBookRequest({ id: 1, status: 'weird' }).status).toBe('pending');
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
			hardcoverId: 427578,
			genres: [],
			formats: [],
			addedAt: null,
			statusAt: null,
			startedAt: null,
			finishedAt: null
		});
	});

	it('reads genres, file kinds and your status dates', () => {
		const b = mapReadingBook({
			...raw,
			genres: ['Science Fiction', 3],
			files: [{ format: 'epub' }, { format: 'm4b' }, { format: 'EPUB' }],
			addedAt: '2026-01-01T00:00:00Z',
			readStatus: { status: 'read', startedAt: '2026-02-01T00:00:00Z', finishedAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' }
		});
		expect(b).toMatchObject({
			genres: ['Science Fiction'],
			formats: ['ebook', 'audiobook'],
			addedAt: '2026-01-01T00:00:00Z',
			startedAt: '2026-02-01T00:00:00Z',
			finishedAt: '2026-03-01T00:00:00Z',
			statusAt: '2026-03-01T00:00:00Z'
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
