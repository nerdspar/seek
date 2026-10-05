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
	progressText,
	sortBooks,
	filterBooks,
	shelfView,
	topGenres,
	bookFiltersActive,
	NO_BOOK_FILTERS,
	formatOf,
	cardBadge,
	mapRelease,
	mapReleaseSearch,
	pickBestRelease,
	emptySearchReason,
	recommendationSeeds,
	librarySeeds,
	mapShelfRow,
	weekActivity,
	readingStreaks,
	finishedByMonth,
	topAuthors,
	highestRated,
	recentlyAdded,
	mapGoal,
	currentGoals,
	goalProgressText,
	goalFormatId,
	contributorAuthors,
	favoriteGenres,
	readingStats,
	bookDiary,
	bookRequestBody,
	mapReview,
	notYours,
	type ShelfBook,
	type MyBook,
	mapBookRequest,
	requestLabel,
	requestCancellable,
	requestFor
} from './books';

/* A library book (BookOrbit): only says the book is in the library. Its own
   status is ignored — reading state lives on your Hardcover shelf. */
const owned = (id: number, title: string, author = 'A', hardcoverId: number | null = null, extra: Record<string, unknown> = {}) =>
	({ ...mapReadingBook({ id, title, authors: [author], readStatus: { status: 'read' }, ...extra }), hardcoverId });
/* A book on your Hardcover shelf. */
const sb = (hardcoverId: number, title: string, over: Partial<ShelfBook> = {}): ShelfBook => ({
	userBookId: 1000 + hardcoverId,
	hardcoverId,
	title,
	authors: ['A'],
	coverUrl: null,
	year: null,
	pages: null,
	genres: [],
	status: 'want_to_read',
	rating: null,
	readId: null,
	startedAt: null,
	finishedAt: null,
	progressPages: null,
	addedAt: '2026-10-01T12:00:00.000Z',
	updatedAt: '2026-10-01T00:00:00Z',
	...over
});

describe('myBooks', () => {
	it('lists your shelf with each book’s library copy, then the library books you haven’t shelved', () => {
		const lib = [owned(1, 'Hyperion', 'Dan Simmons'), owned(2, 'Dune', 'A', 77), owned(3, 'Untouched', 'B')];
		const list = myBooks(lib, [
			sb(50, 'Hyperion', { authors: ['Dan Simmons'], status: 'read' }), // matched by title + author
			sb(77, 'Dune', { status: 'reading' }), // matched by Hardcover id
			sb(9, 'Paper copy', { status: 'reading' }) // not in the library
		]);
		expect(list.map((b) => [b.key, b.source, b.libraryId, b.status])).toEqual([
			['hc:50', 'library', 1, 'read'],
			['hc:77', 'library', 2, 'reading'],
			['hc:9', 'entry', null, 'reading'],
			// BookOrbit says "read", but nothing's on your shelf: in your library, not started.
			['lib:3', 'library', 3, 'unread']
		]);
	});

	it("turns the pages you've read into progress, and a finished book into 100%", () => {
		const [b, done] = myBooks([], [sb(9, 'X', { status: 'reading', pages: 400, progressPages: 124 }), sb(10, 'Y', { status: 'read' })]);
		expect(b.progress).toBeCloseTo(0.31);
		expect(done.progress).toBe(1);
		expect(progressText(b)).toBe('124 / 400 pages · 31%');
		expect(progressText({ progress: 0.5, pages: null })).toBe('50%');
		expect(progressText({ progress: null, pages: 400 })).toBeNull();
	});
});

describe('readingSections', () => {
	const req = (id: number, status: string, hc: number | null) =>
		mapBookRequest({ id, status, title: `R${id}`, ...(hc ? { providerKey: 'hardcover', providerId: String(hc) } : {}) });

	it('groups by status, library or not', () => {
		const books = myBooks([owned(1, 'Dune')], [sb(1, 'Dune', { status: 'reading' }), sb(50, 'Hyperion'), sb(51, 'Paper', { status: 'reading' })]);
		expect(readingSections(books).map((s) => [s.title, s.books.map((b) => b.title)])).toEqual([
			['Reading', ['Dune', 'Paper']],
			['Want to read', ['Hyperion']]
		]);
	});

	it('shows requests on the way after Reading, and takes those wants out of Want to read', () => {
		const books = myBooks([], [sb(1, 'Dune', { status: 'reading' }), sb(50, 'Hyperion'), sb(51, 'Wanted')]);
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
		owned(1, 'The Way of Kings', 'Brandon Sanderson', 101, { genres: ['Fantasy'], files: [{ format: 'epub' }], addedAt: '2026-01-01T00:00:00Z' }),
		owned(2, 'Dune', 'Frank Herbert', 102, { genres: ['Science Fiction', 'Fantasy'], files: [{ format: 'm4b' }], addedAt: '2026-05-01T00:00:00Z' }),
		owned(3, 'A Wizard of Earthsea', 'Ursula K. Le Guin', null, { genres: ['fantasy'], addedAt: '2026-03-01T00:00:00Z' })
	];
	const books = myBooks(lib, [
		sb(101, 'The Way of Kings', { status: 'reading', rating: 5, pages: 1000, progressPages: 600, updatedAt: '2026-09-01T00:00:00Z' }),
		sb(102, 'Dune', { status: 'read', rating: 3, updatedAt: '2026-10-01T00:00:00Z' }),
		sb(9, 'Paper copy', { status: 'reading', updatedAt: '2026-08-01T00:00:00Z', addedAt: '2026-10-02T12:00:00.000Z' })
	]);
	const titles = (bs: MyBook[]) => bs.map((b) => b.title);

	it('sorts every way the sheet offers, ignoring leading articles', () => {
		expect(titles(sortBooks(books, 'title'))).toEqual(['Dune', 'Paper copy', 'The Way of Kings', 'A Wizard of Earthsea']);
		expect(titles(sortBooks(books, 'active'))).toEqual(['Dune', 'The Way of Kings', 'Paper copy', 'A Wizard of Earthsea']);
		expect(titles(sortBooks(books, 'author'))[0]).toBe('Paper copy'); // "A"
		expect(titles(sortBooks(books, 'rating')).slice(0, 2)).toEqual(['The Way of Kings', 'Dune']);
		expect(titles(sortBooks(books, 'progress'))[0]).toBe('Dune'); // finished = 100%
		expect(titles(sortBooks(books, 'added'))[0]).toBe('Paper copy');
	});

	it('filters by status, kind, shelf and genre (case-insensitive)', () => {
		expect(titles(filterBooks(books, { ...NO_BOOK_FILTERS, status: 'reading' }))).toEqual(['The Way of Kings', 'Paper copy']);
		expect(titles(filterBooks(books, { ...NO_BOOK_FILTERS, kind: 'audiobook' }))).toEqual(['Dune']);
		expect(titles(filterBooks(books, { ...NO_BOOK_FILTERS, kind: 'mine' }))).toEqual(['Paper copy']);
		// The Library's "Not started": in BookOrbit, nothing on your shelf.
		expect(titles(filterBooks(books, { ...NO_BOOK_FILTERS, status: 'unstarted' }))).toEqual(['A Wizard of Earthsea']);
		expect(titles(filterBooks(books, { ...NO_BOOK_FILTERS, shelf: 4 }, new Set([2, 3])))).toEqual(['Dune', 'A Wizard of Earthsea']);
		expect(titles(filterBooks(books, { ...NO_BOOK_FILTERS, genre: 'FANTASY' }))).toHaveLength(3);
		expect(bookFiltersActive(NO_BOOK_FILTERS)).toBe(false);
		expect(bookFiltersActive({ ...NO_BOOK_FILTERS, genre: 'x' })).toBe(true);
	});

	it('your books: only what is on your shelf, by view (Archive = paused or did not finish)', () => {
		const more = myBooks(lib, [
			sb(101, 'The Way of Kings', { status: 'reading' }),
			sb(102, 'Dune', { status: 'abandoned' }),
			sb(9, 'Paper copy', { status: 'on_hold' }),
			sb(10, 'Wanted', { status: 'want_to_read' })
		]);
		expect(titles(shelfView(more, 'all'))).toEqual(['The Way of Kings', 'Dune', 'Paper copy', 'Wanted']);
		expect(titles(shelfView(more, 'archive'))).toEqual(['Dune', 'Paper copy']);
		expect(titles(shelfView(more, 'want_to_read'))).toEqual(['Wanted']);
		expect(titles(shelfView(more, 'read'))).toEqual([]);
	});

	it('offers the most common genres first, leaving out codes and placeholders', () => {
		expect(topGenres(books)).toEqual(['Fantasy', 'Science Fiction']);
		const junk = myBooks([mapReadingBook({ id: 9, title: 'X', genres: ['FIC000000', 'None', 'General', 'Horror'] })], []);
		expect(topGenres(junk)).toEqual(['Horror']);
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

describe('release search', () => {
	const rel = (over: Record<string, unknown>) => ({
		indexerId: 1,
		indexerName: 'Prowlarr',
		guid: 'g',
		title: 'Dune (epub)',
		sizeBytes: 1_000_000,
		seeders: 10,
		format: 'epub',
		score: 50,
		vipOnly: false,
		alreadyGrabbed: false,
		profileMismatch: null,
		...over
	});

	it('maps releases and says why one is outside the profile', () => {
		const r = mapRelease(
			rel({ profileMismatch: { tier: 1, tierName: 'Ebooks', failures: [{ code: 'format', expected: ['epub'], actual: ['pdf'] }, { code: 'seeders', expected: 2, actual: 0 }] } })
		);
		expect(r).toMatchObject({ source: 'Prowlarr', format: 'epub', mismatch: 'not epub, too few seeders' });
	});

	it('Automatic picks the best-ranked release that fits and can be fetched', () => {
		const releases = [
			rel({ guid: 'a', score: 90, vipOnly: true }),
			rel({ guid: 'b', score: 80, profileMismatch: { failures: [{ code: 'size' }] } }),
			rel({ guid: 'c', score: 60, seeders: 1 }),
			rel({ guid: 'd', score: 60, seeders: 30 }),
			rel({ guid: 'e', score: 70, alreadyGrabbed: true })
		].map(mapRelease);
		expect(pickBestRelease(releases)?.guid).toBe('d');
		expect(pickBestRelease([])).toBeNull();
	});

	it('explains an empty or unusable search', () => {
		const s = (over: Record<string, unknown>) =>
			mapReleaseSearch({ releases: [], indexers: [], enabledIndexerCount: 2, ...over });
		expect(emptySearchReason(s({ enabledIndexerCount: 0 }))).toMatch(/no download sources/);
		expect(
			emptySearchReason(
				s({ indexers: [{ indexerName: 'Prowlarr', ok: true }, { indexerName: 'MAM', ok: false, failure: 'timeout' }] })
			)
		).toBe('No releases found (searched 2 sources). MAM timed out.');
		expect(emptySearchReason(s({ releases: [rel({ profileMismatch: { failures: [] } })], indexers: [{ ok: true }] }))).toMatch(
			/none fit your release profile/
		);
	});
});

describe('your Hardcover shelf', () => {
	const ub = (id: number, status_id: number, { book, user_book_reads, ...over }: Record<string, unknown> = {}) => ({
		id: 5000 + id,
		status_id,
		rating: null,
		date_added: '2026-04-02',
		updated_at: '2026-05-01T10:00:00+00:00',
		...over,
		user_book_reads: user_book_reads ?? [],
		book: {
			id,
			title: `Book ${id}`,
			pages: 320,
			cached_contributors: [
				{ author: { name: 'Ann Author' }, contribution: null },
				{ author: { name: 'Nate Narrator' }, contribution: 'Narrator' }
			],
			cached_tags: { Genre: [{ tag: 'Fantasy' }, { tag: 'fantasy' }, { tag: 'Adventure' }] },
			...((book as object) ?? {})
		}
	});

	it('maps a shelf row: status, rounded rating, the latest read, calendar days at midday UTC', () => {
		const b = mapShelfRow(
			ub(1, 3, { rating: 4.5, user_book_reads: [{ id: 77, started_at: '2026-04-20', finished_at: '2026-05-01', progress_pages: 320 }] })
		);
		expect(b).toEqual({
			userBookId: 5001,
			hardcoverId: 1,
			title: 'Book 1',
			authors: ['Ann Author'],
			coverUrl: null,
			year: null,
			pages: 320,
			genres: ['Fantasy', 'Adventure'],
			status: 'read',
			rating: 5,
			readId: 77,
			startedAt: '2026-04-20T12:00:00.000Z',
			finishedAt: '2026-05-01T12:00:00.000Z',
			progressPages: 320,
			addedAt: '2026-04-02T12:00:00.000Z',
			updatedAt: '2026-05-01T10:00:00+00:00'
		});
	});

	it("knows Hardcover's five shelves and skips Ignored and broken rows", () => {
		const rows = [ub(1, 1), ub(2, 2), ub(3, 3), ub(4, 4), ub(5, 5), ub(6, 6), { id: 9, status_id: 3, book: null }];
		expect(rows.map(mapShelfRow).map((b) => b?.status ?? null)).toEqual(['want_to_read', 'reading', 'read', 'on_hold', 'abandoned', null, null]);
	});

	it('names only the authors among the contributors', () => {
		expect(contributorAuthors([{ author: { name: 'A' } }, { author: { name: 'B' }, contribution: 'Translator' }, { author: { name: 'C' }, contribution: 'Author' }])).toEqual(['A', 'C']);
	});
});

describe('what recommendations grow from', () => {
	const lib = [
		owned(1, 'Mistborn', 'Brandon Sanderson', 5, { genres: ['Fantasy'] }),
		owned(2, 'Dune', 'Frank Herbert', 6, { genres: ['Science Fiction'] }),
		owned(3, 'Piranesi', 'Susanna Clarke', 7, { genres: ['Fantasy'] }),
		owned(4, 'Unopened', 'X', 8, { genres: ['Horror', 'Horror'] })
	];
	const books = myBooks(lib, [
		sb(5, 'Mistborn', { status: 'read', rating: 5, finishedAt: '2026-01-01T12:00:00.000Z', updatedAt: '2026-01-01T00:00:00Z' }),
		sb(6, 'Dune', { status: 'read', rating: 2, finishedAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T00:00:00Z' }),
		sb(7, 'Piranesi', { status: 'reading' }),
		sb(9, 'Loved paper copy', { status: 'reading', rating: 5, updatedAt: '2026-10-02T00:00:00Z' })
	]);

	it('grows from what you finished or loved, loved first', () => {
		// Both loved: the more recently active one leads; the 2-star read comes last.
		expect(recommendationSeeds(books).map((b) => b.title)).toEqual(['Loved paper copy', 'Mistborn', 'Dune']);
	});

	it('falls back to the newest books in your library when nothing is finished or loved', () => {
		const unread = myBooks(
			[
				owned(1, 'Old', 'A', 1, { addedAt: '2025-01-01T00:00:00Z' }),
				owned(2, 'New', 'B', 2, { addedAt: '2026-09-01T00:00:00Z' }),
				owned(3, 'Gave up', 'C', 3, { addedAt: '2026-10-01T00:00:00Z' })
			],
			[sb(3, 'Gave up', { authors: ['C'], status: 'abandoned' }), sb(9, 'Just a wish')]
		);
		expect(recommendationSeeds(unread)).toEqual([]);
		expect(librarySeeds(unread).map((b) => b.title)).toEqual(['New', 'Old']);
	});

	it('weights genres by your ratings, ignoring books you have not started', () => {
		expect(favoriteGenres(books)).toEqual(['Fantasy', 'Science Fiction']);
		// Genres looked up from Hardcover count too — a 5-star book's weigh most.
		expect(favoriteGenres(books, new Map([['hc:9', ['Romance', 'Romance']]]), 1)).toEqual(['Romance']);
	});

	it('never recommends something you already have', () => {
		const cards = [
			{ hardcoverId: 5, title: 'Mistborn', author: 'Brandon Sanderson', coverUrl: null, year: null, rating: null },
			{ hardcoverId: 50, title: 'The Way of Kings', author: 'Brandon Sanderson', coverUrl: null, year: null, rating: null },
			{ hardcoverId: 51, title: 'Unopened', author: 'X', coverUrl: null, year: null, rating: null }
		];
		expect(notYours(cards, books).map((c) => c.hardcoverId)).toEqual([50]);
	});
});

describe('reading over time', () => {
	const now = new Date('2026-10-15T12:00:00');
	const books = myBooks(
		[owned(1, 'A', 'X', 1, { genres: ['Fantasy'] })],
		[
			sb(1, 'A', { status: 'read', pages: 300, rating: 4, startedAt: '2026-09-20T12:00:00.000Z', finishedAt: '2026-10-02T12:00:00.000Z' }),
			sb(2, 'B', { status: 'read', pages: 200, rating: 2, genres: ['Fantasy', 'Horror'], finishedAt: '2026-03-01T12:00:00.000Z' }),
			sb(3, 'C', { status: 'read', pages: 500, finishedAt: '2025-06-01T12:00:00.000Z' }),
			sb(4, 'D', { status: 'reading', startedAt: '2026-10-10T12:00:00.000Z' })
		]
	);

	it('counts what you finished in a range, with pages, ratings and genres', () => {
		expect(readingStats(books, 'this_month', now)).toMatchObject({ finished: 1, pages: 300, avgRating: 4, reading: 1 });
		const year = readingStats(books, 'this_year', now);
		expect(year).toMatchObject({ finished: 2, pages: 500, avgRating: 3 });
		expect(year.topGenres).toEqual([{ name: 'Fantasy', count: 2 }, { name: 'Horror', count: 1 }]);
		expect(year.recent.map((b) => b.title)).toEqual(['A', 'B']);
		expect(readingStats(books, 'last_year', now).finished).toBe(1);
		expect(readingStats(books, 'all_time', now).finished).toBe(3);
	});

	it('lays your reading out as a diary, newest day first', () => {
		const days = bookDiary(books);
		expect(days[0].entries.map((e) => `${e.what} ${e.book.title}`)).toEqual(['Started D']);
		expect(days.flatMap((d) => d.entries).map((e) => `${e.what} ${e.book.title}`)).toEqual([
			'Started D',
			'Finished A',
			'Started A',
			'Finished B',
			'Finished C'
		]);
	});
});

describe('download request details', () => {
	const book = { hardcoverId: 379760, title: '1984', author: 'George Orwell', coverUrl: null, year: 1949 };
	const isbns = { ebook: '9780547249643', physical: '9786057462220', audio: '9780140862539' };

	it("asks for the edition's ISBN and searches the others too", () => {
		const ebook = bookRequestBody(book, 'ebook', 3, isbns);
		expect(ebook).toMatchObject({ isbn13: '9780547249643', targetLibraryId: 3 });
		expect(ebook.metadataSources?.map((m) => m.isbn13)).toEqual(['9786057462220', '9780140862539']);
		expect(bookRequestBody(book, 'audiobook', null, isbns).isbn13).toBe('9780140862539');
		expect(bookRequestBody(book, 'ebook', null, { ebook: null, physical: '978X', audio: null }).isbn13).toBe('978X');
		const bare = bookRequestBody(book, 'ebook', null);
		expect('isbn13' in bare || 'metadataSources' in bare).toBe(false);
	});

	it("reads BookOrbit's review: why it's waiting, side by side", () => {
		const r = mapReview({
			requestId: 9,
			bookDockFileId: 4,
			canFile: true,
			verification: {
				score: 30,
				threshold: 70,
				reason: 'imported "Nineteen Eighty-Four" scored 30, below the 70 needed',
				rows: [
					{ field: 'title', requested: '1984', imported: 'Nineteen Eighty-Four', verdict: 'mismatch' },
					{ field: 'authors', requested: 'George Orwell', imported: 'George Orwell', verdict: 'match' },
					{ field: 'isbn13', requested: null, imported: '9780899663685', verdict: 'unknown' }
				]
			},
			files: [{ fileName: '1984 (v5.0).epub', fileSize: 297000, format: 'epub', role: 'primary' }]
		});
		expect(r).toMatchObject({ score: 30, threshold: 70, canFile: true, gone: false });
		expect(r.rows.map((x) => [x.field, x.verdict])).toEqual([
			['Title', 'mismatch'],
			['Author', 'match'],
			['ISBN', 'unknown']
		]);
		expect(r.files[0]).toEqual({ name: '1984 (v5.0).epub', format: 'epub', sizeBytes: 297000 });
		expect(mapReview({ bookDockFileId: null, verification: null, files: [] }).gone).toBe(true);
	});
});

describe('reading goals', () => {
	const raw = (over: Record<string, unknown> = {}) => ({
		id: 7,
		description: '2026 Reading Goal',
		metric: 'book',
		goal: 12,
		progress: 3,
		start_date: '2026-01-01',
		end_date: '2026-12-31',
		archived: false,
		conditions: {},
		...over
	});

	it("maps Hardcover's goal: metric, target, Hardcover's count, what counts, the dates", () => {
		expect(mapGoal(raw())).toEqual({
			id: 7,
			title: '2026 Reading Goal',
			metric: 'book',
			target: 12,
			done: 3,
			format: 'any',
			startDate: '2026-01-01',
			endDate: '2026-12-31'
		});
		expect(mapGoal(raw({ metric: 'hour', progress: 4.567, conditions: { readingFormatId: 2 } }))).toMatchObject({ metric: 'hour', done: 4.6, format: 'listen' });
		expect(mapGoal(raw({ conditions: { readingFormatId: 1 } }))?.format).toBe('read');
		expect(mapGoal(raw({ archived: true }))).toBeNull();
		expect(mapGoal(raw({ metric: 'chapter' }))).toBeNull();
		expect(goalFormatId('any')).toBeNull();
		expect(goalFormatId('listen')).toBe(2);
	});

	it('keeps the goals still running, soonest-ending first', () => {
		const goals = [raw({ id: 1, end_date: '2026-12-31' }), raw({ id: 2, end_date: '2026-10-31' }), raw({ id: 3, end_date: '2025-12-31' })].map((g) => mapGoal(g)!);
		expect(currentGoals(goals, '2026-10-04').map((g) => g.id)).toEqual([2, 1]);
	});

	it('says the progress in its own units', () => {
		expect(goalProgressText({ metric: 'book', target: 12, done: 3 })).toBe('3 of 12 books');
		expect(goalProgressText({ metric: 'page', target: 5000, done: 1240 })).toBe('1,240 of 5,000 pages');
		expect(goalProgressText({ metric: 'hour', target: 1, done: 0.5 })).toBe('0.5 of 1 hour');
	});
});

describe('Profile → Reading', () => {
	const today = '2026-10-05';

	it('lays out the last seven days, oldest first, marking the days you read', () => {
		expect(weekActivity(['2026-10-05', '2026-10-03', '2026-09-28'], today)).toEqual([
			{ day: '2026-09-29', read: false },
			{ day: '2026-09-30', read: false },
			{ day: '2026-10-01', read: false },
			{ day: '2026-10-02', read: false },
			{ day: '2026-10-03', read: true },
			{ day: '2026-10-04', read: false },
			{ day: '2026-10-05', read: true }
		]);
	});

	it('counts streaks: the current one lives through today if you read yesterday', () => {
		const days = ['2026-10-04', '2026-10-03', '2026-10-02', '2026-09-20', '2026-09-19', '2026-09-18', '2026-09-17'];
		expect(readingStreaks(days, today)).toEqual({ current: 3, longest: 4 });
		expect(readingStreaks(['2026-10-01'], today)).toEqual({ current: 0, longest: 1 });
		expect(readingStreaks([], today)).toEqual({ current: 0, longest: 0 });
	});

	const books = myBooks(
		[mapReadingBook({ id: 1, title: 'Lib new', authors: ['Z'], addedAt: '2026-09-01T00:00:00Z' }), mapReadingBook({ id: 2, title: 'Lib old', authors: ['Y'], addedAt: '2025-01-01T00:00:00Z' })],
		[
			sb(1, 'A', { authors: ['Andy Weir'], status: 'read', rating: 5, finishedAt: '2026-03-10T12:00:00.000Z' }),
			sb(2, 'B', { authors: ['Andy Weir'], status: 'read', rating: 3, finishedAt: '2026-03-20T12:00:00.000Z' }),
			sb(3, 'C', { authors: ['N. K. Jemisin'], status: 'read', finishedAt: '2025-12-01T12:00:00.000Z' }),
			sb(4, 'D', { authors: ['Q'], status: 'reading', rating: 4 })
		]
	);

	it('counts finished books per month, top authors, best-rated and newest arrivals', () => {
		expect(finishedByMonth(books, 2026)).toEqual([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		expect(topAuthors(books)).toEqual([
			{ name: 'Andy Weir', count: 2 },
			{ name: 'N. K. Jemisin', count: 1 }
		]);
		expect(highestRated(books).map((b) => b.title)).toEqual(['A', 'D', 'B']);
		expect(recentlyAdded(books).map((b) => b.title)).toEqual(['Lib new', 'Lib old']);
	});
});
