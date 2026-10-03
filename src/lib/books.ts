/**
 * Books — shared types and pure mappers for the book subsystem (spec:
 * docs/books-plan.md). Discovery comes from Hardcover; the reading list, status,
 * progress, goals and stats come from the self-hosted BookOrbit. Everything here
 * is client-safe (no server imports) so the UI and the unit tests can use it.
 */

/** BookOrbit's reading-status enum (packages/types book.ts READ_STATUSES). */
export type BookReadStatus =
	| 'unread'
	| 'want_to_read'
	| 'reading'
	| 'on_hold'
	| 'rereading'
	| 'read'
	| 'skimmed'
	| 'abandoned';

/** A row on the reading list — one owned book in BookOrbit with its state. */
export type ReadingBook = {
	id: number;
	title: string;
	authors: string[];
	status: BookReadStatus;
	/** 0..1, or null when never opened. */
	progress: number | null;
	rating: number | null;
	pageCount: number | null;
	year: number | null;
	seriesName: string | null;
	seriesIndex: number | null;
	/** Seek-proxied cover (BookOrbit covers are auth-gated), or null. */
	coverUrl: string | null;
	/** Link to Hardcover, when BookOrbit matched an edition — lets Discover mark
	 *  a result as already owned. */
	hardcoverId: number | null;
	genres: string[];
	/** What kinds of file BookOrbit holds for it. */
	formats: BookFormat[];
	addedAt: string | null;
	/** When your status last changed, and when you started / finished it. */
	statusAt: string | null;
	startedAt: string | null;
	finishedAt: string | null;
};

export type BookFormat = 'ebook' | 'audiobook' | 'comic';

const AUDIO = new Set(['m4b', 'm4a', 'mp3', 'opus', 'ogg', 'flac', 'aac', 'wav']);
const COMIC = new Set(['cbz', 'cbr', 'cb7', 'cbt']);
export const formatOf = (ext: string): BookFormat =>
	AUDIO.has(ext.toLowerCase()) ? 'audiobook' : COMIC.has(ext.toLowerCase()) ? 'comic' : 'ebook';

/** A discovery result from Hardcover — a book you may not own yet. */
export type BookCard = {
	hardcoverId: number;
	title: string;
	author: string | null;
	/** Public Hardcover asset URL — safe to use directly in an <img>. */
	coverUrl: string | null;
	year: number | null;
	/** Community rating, 0..5, or null. */
	rating: number | null;
};

/** Your copy of a discovery result, when it's in your library. */
export type OwnedSummary = {
	bookId: number;
	status: BookReadStatus;
	progress: number | null;
	rating?: number | null;
	pages?: number | null;
};

/** A discovery result as the UI gets it: with your library copy, or your own
 *  status on it, when there is one. */
export type DiscoveryCard = BookCard & { owned?: OwnedSummary | null; mine?: BookReadStatus | null };

/** A discovery shelf (Popular this year, New releases, …). */
export type BookRail = { key: string; title: string; subtitle: string; books: BookCard[] };

/** Everything the book sheet shows about a Hardcover book. */
export type BookDetail = BookCard & {
	subtitle: string | null;
	description: string | null;
	pages: number | null;
	ratingsCount: number | null;
	/** How many Hardcover readers have it on a shelf — a popularity signal. */
	readers: number | null;
	genres: string[];
	moods: string[];
	series: { name: string; position: number | null } | null;
};

const STATUS_LABELS: Record<BookReadStatus, string> = {
	unread: 'In your library',
	want_to_read: 'Want to read',
	reading: 'Reading',
	on_hold: 'On hold',
	rereading: 'Rereading',
	read: 'Read',
	skimmed: 'Skimmed',
	abandoned: 'Did not finish'
};

export const statusLabel = (s: BookReadStatus) => STATUS_LABELS[s];

/** The badge on a discovery cover: your status if it's in your library, else
 *  your status on it as one of your own books, else nothing. A library book
 *  you haven't started shows "In your library". */
export function cardBadge(c: { owned?: { status: BookReadStatus } | null; mine?: BookReadStatus | null }): string | null {
	if (c.owned) return statusLabel(c.owned.status);
	return c.mine ? statusLabel(c.mine) : null;
}

/** The reading list's sections, in order. Books you own but haven't started
 *  ("unread") aren't a section — they're the library, browsed separately. */
export const READING_SECTIONS: { title: string; statuses: BookReadStatus[] }[] = [
	{ title: 'Reading', statuses: ['reading', 'rereading'] },
	{ title: 'Want to read', statuses: ['want_to_read'] },
	{ title: 'On hold', statuses: ['on_hold'] },
	{ title: 'Read', statuses: ['read', 'skimmed'] },
	{ title: 'Did not finish', statuses: ['abandoned'] }
];

/** Group a library into the reading list's sections (empty ones dropped). */
export function groupReading(
	books: ReadingBook[]
): { title: string; books: ReadingBook[] }[] {
	return READING_SECTIONS.map((s) => ({
		title: s.title,
		books: books.filter((b) => s.statuses.includes(b.status))
	})).filter((s) => s.books.length);
}

/* ── Your books outside the library ─────────────────────────────────────────
   A book you track that isn't in BookOrbit (a physical copy, a loan, one you
   want) — Seek keeps your status, rating and page for it. */

/** The statuses a book outside the library can have ('unread' means "in the
 *  library, not started", which doesn't apply). */
export type EntryStatus = Exclude<BookReadStatus, 'unread' | 'rereading' | 'skimmed'>;
export const ENTRY_STATUSES: EntryStatus[] = ['want_to_read', 'reading', 'on_hold', 'read', 'abandoned'];

export type BookEntry = BookCard & {
	pages: number | null;
	status: EntryStatus;
	/** Your rating, 1–5. */
	myRating: number | null;
	progressPages: number | null;
	startedAt: string | null;
	finishedAt: string | null;
	addedAt: string;
	updatedAt: string;
};

/* ── One list: library books and your own entries ───────────────────────────── */

/** A book on your reading list, wherever its state lives. */
export type MyBook = {
	/** Unique across both sources: `lib:<bookorbit id>` or `hc:<hardcover id>`. */
	key: string;
	source: 'library' | 'entry';
	libraryId: number | null;
	hardcoverId: number | null;
	title: string;
	authors: string[];
	coverUrl: string | null;
	year: number | null;
	status: BookReadStatus;
	/** Your rating, 1–5. */
	myRating: number | null;
	pages: number | null;
	/** 0..1, or null when there's nothing to show. */
	progress: number | null;
	seriesName: string | null;
	seriesIndex: number | null;
	genres: string[];
	formats: BookFormat[];
	addedAt: string | null;
	/** Last time your status changed — "recently active" ordering. */
	activeAt: string | null;
	startedAt: string | null;
	finishedAt: string | null;
};

export const fromLibrary = (b: ReadingBook): MyBook => ({
	key: `lib:${b.id}`,
	source: 'library',
	libraryId: b.id,
	hardcoverId: b.hardcoverId,
	title: b.title,
	authors: b.authors,
	coverUrl: b.coverUrl,
	year: b.year,
	status: b.status,
	myRating: b.rating,
	pages: b.pageCount,
	progress: b.progress,
	seriesName: b.seriesName,
	seriesIndex: b.seriesIndex,
	genres: b.genres,
	formats: b.formats,
	addedAt: b.addedAt,
	activeAt: b.statusAt ?? b.addedAt,
	startedAt: b.startedAt,
	finishedAt: b.finishedAt
});

export const fromEntry = (e: BookEntry): MyBook => ({
	key: `hc:${e.hardcoverId}`,
	source: 'entry',
	libraryId: null,
	hardcoverId: e.hardcoverId,
	title: e.title,
	authors: e.author ? [e.author] : [],
	coverUrl: e.coverUrl,
	year: e.year,
	status: e.status,
	myRating: e.myRating,
	pages: e.pages,
	progress: e.pages && e.progressPages != null ? Math.min(1, e.progressPages / e.pages) : null,
	seriesName: null,
	seriesIndex: null,
	genres: [],
	formats: [],
	addedAt: e.addedAt,
	activeAt: e.updatedAt,
	startedAt: e.startedAt,
	finishedAt: e.finishedAt
});

/** Your entries matched to the library copy that has since arrived. */
export function arrivedEntries(entries: BookEntry[], library: ReadingBook[]): { entry: BookEntry; book: ReadingBook }[] {
	const byHc = new Map(library.filter((b) => b.hardcoverId).map((b) => [b.hardcoverId!, b]));
	const byKey = new Map(library.map((b) => [bookKey(b.title, b.authors[0]), b]));
	return entries.flatMap((entry) => {
		const book = byHc.get(entry.hardcoverId) ?? byKey.get(bookKey(entry.title, entry.author));
		return book ? [{ entry, book }] : [];
	});
}

/** The whole list: every library book plus your entries for books you don't
 *  own. Once a book is in the library, its library copy is the one shown. */
export function myBooks(library: ReadingBook[], entries: BookEntry[]): MyBook[] {
	const arrived = new Set(arrivedEntries(entries, library).map((a) => a.entry.hardcoverId));
	return [...library.map(fromLibrary), ...entries.filter((e) => !arrived.has(e.hardcoverId)).map(fromEntry)];
}

/** "123 / 400 pages · 31%" (or just the percent when the page count is unknown). */
export function progressText(b: Pick<MyBook, 'progress' | 'pages'>): string | null {
	if (b.progress === null) return null;
	const pct = Math.round(b.progress * 100);
	if (!b.pages) return `${pct}%`;
	return `${Math.round(b.progress * b.pages)} / ${b.pages} pages · ${pct}%`;
}

/* ── Sorting and filtering the list ─────────────────────────────────────────── */

export type BookSort = 'active' | 'title' | 'author' | 'added' | 'progress' | 'rating';
export const BOOK_SORTS: { key: BookSort; label: string }[] = [
	{ key: 'active', label: 'Recently active' },
	{ key: 'title', label: 'Title' },
	{ key: 'author', label: 'Author' },
	{ key: 'added', label: 'Recently added' },
	{ key: 'progress', label: 'Progress' },
	{ key: 'rating', label: 'Your rating' }
];

const sortTitle = (t: string) => t.toLowerCase().replace(/^(the|a|an)\s+/, '');
const surname = (a: string | undefined) => (a ?? '').trim().split(/\s+/).pop()?.toLowerCase() ?? '';
const newestFirst = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '');

export function sortBooks(books: MyBook[], sort: BookSort): MyBook[] {
	const byTitle = (a: MyBook, b: MyBook) => sortTitle(a.title).localeCompare(sortTitle(b.title));
	const cmp: Record<BookSort, (a: MyBook, b: MyBook) => number> = {
		active: (a, b) => newestFirst(a.activeAt, b.activeAt) || byTitle(a, b),
		title: byTitle,
		// Author by surname, then a series in reading order, then title.
		author: (a, b) =>
			surname(a.authors[0]).localeCompare(surname(b.authors[0])) ||
			(a.seriesName ?? '').localeCompare(b.seriesName ?? '') ||
			(a.seriesIndex ?? 0) - (b.seriesIndex ?? 0) ||
			byTitle(a, b),
		added: (a, b) => newestFirst(a.addedAt, b.addedAt) || byTitle(a, b),
		progress: (a, b) => (b.progress ?? -1) - (a.progress ?? -1) || byTitle(a, b),
		rating: (a, b) => (b.myRating ?? 0) - (a.myRating ?? 0) || byTitle(a, b)
	};
	return [...books].sort(cmp[sort]);
}

/** Which books: by status, by where it lives / what kind of file, by one of
 *  your shelves, by genre. */
export type BookFilters = {
	status: 'all' | 'reading' | 'want_to_read' | 'on_hold' | 'read' | 'abandoned' | 'unstarted';
	/** ebook / audiobook: files in BookOrbit; `mine`: your own books outside it. */
	kind: 'all' | 'ebook' | 'audiobook' | 'mine';
	/** A shelf (BookOrbit collection) id. */
	shelf: number | null;
	genre: string | null;
};
export const NO_BOOK_FILTERS: BookFilters = { status: 'all', kind: 'all', shelf: null, genre: null };

export const bookFiltersActive = (f: BookFilters) =>
	f.status !== 'all' || f.kind !== 'all' || f.shelf !== null || f.genre !== null;

const STATUS_FILTER: Record<Exclude<BookFilters['status'], 'all'>, BookReadStatus[]> = {
	reading: ['reading', 'rereading'],
	want_to_read: ['want_to_read'],
	on_hold: ['on_hold'],
	read: ['read', 'skimmed'],
	abandoned: ['abandoned'],
	unstarted: ['unread']
};

/** `shelfIds`: the library ids on the chosen shelf (fetched separately). */
export function filterBooks(books: MyBook[], f: BookFilters, shelfIds: Set<number> | null = null): MyBook[] {
	return books.filter((b) => {
		if (f.status !== 'all' && !STATUS_FILTER[f.status].includes(b.status)) return false;
		if (f.kind === 'mine' && b.source !== 'entry') return false;
		if ((f.kind === 'ebook' || f.kind === 'audiobook') && !b.formats.includes(f.kind)) return false;
		if (f.shelf !== null && !(b.libraryId !== null && shelfIds?.has(b.libraryId))) return false;
		if (f.genre !== null && !b.genres.some((g) => g.toLowerCase() === f.genre!.toLowerCase())) return false;
		return true;
	});
}

/** The genres across your books, most common first — the filter's choices. */
export function topGenres(books: MyBook[], max = 12): string[] {
	const counts = new Map<string, { name: string; n: number }>();
	for (const b of books)
		for (const g of b.genres) {
			const k = g.toLowerCase();
			const c = counts.get(k) ?? { name: g, n: 0 };
			c.n++;
			counts.set(k, c);
		}
	return [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, max).map((c) => c.name);
}

export type ReadingSection = { title: string; books: MyBook[]; requests: BookRequest[] };

/** The reading list: status sections, plus the books you've asked BookOrbit
 *  for (while on the way) right after Reading — minus any of your own entries
 *  that are already shown as on the way. */
export function readingSections(books: MyBook[], requests: BookRequest[] = []): ReadingSection[] {
	const onTheWay = requests.filter((r) => requestActive(r.status));
	const coming = new Set(onTheWay.map((r) => r.hardcoverId).filter(Boolean));
	const shown = books.filter((b) => !(b.source === 'entry' && b.status === 'want_to_read' && coming.has(b.hardcoverId)));
	const sections: ReadingSection[] = READING_SECTIONS.map((s) => ({
		title: s.title,
		books: shown.filter((b) => s.statuses.includes(b.status)),
		requests: []
	}));
	sections.splice(1, 0, { title: 'Requested', books: [], requests: onTheWay });
	return sections.filter((s) => s.books.length || s.requests.length);
}

/* ── Requests: asking BookOrbit to get a book you don't own ─────────────────
   BookOrbit runs the whole pipeline (approval → Prowlarr search → download
   client → import); Seek files the request as you and shows where it is. */

export type RequestMediaKind = 'ebook' | 'audiobook';

export type BookRequestStatus =
	| 'pending'
	| 'approved'
	| 'rejected'
	| 'cancelled'
	| 'searching'
	| 'grabbed'
	| 'downloading'
	| 'importing'
	| 'needs_review'
	| 'available'
	| 'failed';

export type BookRequest = {
	id: number;
	status: BookRequestStatus;
	title: string;
	author: string | null;
	coverUrl: string | null;
	/** The Hardcover id it was requested from, when it came from Seek/Hardcover. */
	hardcoverId: number | null;
	mediaKind: RequestMediaKind | 'comic';
	/** 0..1 while a download is running, else null. */
	progress: number | null;
	/** Why it failed or was rejected, in BookOrbit's words. */
	reason: string | null;
	/** The library book once it's arrived. */
	bookId: number | null;
	createdAt: string;
};

const REQUEST_LABELS: Record<BookRequestStatus, string> = {
	pending: 'Waiting for approval',
	approved: 'Approved',
	rejected: 'Declined',
	cancelled: 'Cancelled',
	searching: 'Searching',
	grabbed: 'Found — starting download',
	downloading: 'Downloading',
	importing: 'Adding to library',
	needs_review: 'Needs a look in BookOrbit',
	available: 'In your library',
	failed: "Couldn't get it"
};

export const requestLabel = (s: BookRequestStatus) => REQUEST_LABELS[s];

/** Still on its way (BookOrbit's ACTIVE statuses) — not settled either way. */
export const requestActive = (s: BookRequestStatus) =>
	['pending', 'approved', 'searching', 'grabbed', 'downloading', 'importing', 'needs_review'].includes(s);

/** Can still be called off (BookOrbit's CANCELLABLE statuses). */
export const requestCancellable = (s: BookRequestStatus) => requestActive(s) || s === 'failed';

/** Your request for a Hardcover book worth showing: the live one if there is
 *  one, else the latest that settled badly (so "declined"/"failed" is visible
 *  and you can ask again). Cancelled and fulfilled ones are history. */
export function requestFor(requests: BookRequest[], hardcoverId: number): BookRequest | null {
	const mine = requests.filter((r) => r.hardcoverId === hardcoverId);
	return (
		mine.find((r) => requestActive(r.status)) ??
		mine.find((r) => r.status === 'failed' || r.status === 'rejected') ??
		null
	);
}

const REQUEST_STATUSES = Object.keys(REQUEST_LABELS) as BookRequestStatus[];

/** Map one BookOrbit `BookRequestItem` to what Seek shows. */
export function mapBookRequest(raw: unknown): BookRequest {
	const r = rec(raw);
	const status = str(r.status);
	const download = rec(r.download);
	const running = ['grabbed', 'downloading'].includes(status ?? '') && num(download.progressPercent) !== null;
	const hc = str(r.providerKey) === 'hardcover' ? Number(str(r.providerId)) : NaN;
	const kind = str(r.mediaKind);
	return {
		id: num(r.id) ?? 0,
		status: status && (REQUEST_STATUSES as string[]).includes(status) ? (status as BookRequestStatus) : 'pending',
		title: str(r.title) ?? 'Untitled',
		author: authorNames(r.authors)[0] ?? null,
		coverUrl: str(r.coverUrl),
		hardcoverId: Number.isInteger(hc) && hc > 0 ? hc : null,
		mediaKind: kind === 'audiobook' || kind === 'comic' ? kind : 'ebook',
		progress: running ? normalizeProgress(num(download.progressPercent)! / 100) : null,
		reason: str(r.decisionNote) ?? str(r.statusReason) ?? str(download.errorMessage),
		bookId: num(r.matchedBookId),
		createdAt: str(r.createdAt) ?? ''
	};
}

/**
 * The body for BookOrbit's POST /book-requests from a Hardcover book. Only keys
 * its DTO declares — it rejects unknown ones (forbidNonWhitelisted). The
 * provider key/id let BookOrbit fold a second request for the same book into
 * the first, and tie the request back to the Hardcover book here.
 */
export function bookRequestBody(
	book: Pick<BookCard, 'hardcoverId' | 'title' | 'author' | 'coverUrl' | 'year'>,
	mediaKind: RequestMediaKind,
	targetLibraryId: number | null,
	isbns: EditionIsbns | null = null
) {
	/* The ISBN of the edition being asked for: sources are searched by ISBN
	   first, and a download whose ISBN matches is filed without review. A
	   different edition's ISBN never counts against one, so it's safe to send;
	   the other editions ride along as extra ISBNs to search for. */
	const primary = isbns ? (mediaKind === 'audiobook' ? isbns.audio : (isbns.ebook ?? isbns.physical)) : null;
	const others = isbns ? [isbns.ebook, isbns.physical, isbns.audio].filter((i): i is string => Boolean(i) && i !== primary) : [];
	return {
		title: book.title,
		mediaKind,
		authors: book.author ? [book.author] : [],
		...(book.year ? { publishedYear: book.year } : {}),
		...(book.coverUrl ? { coverUrl: book.coverUrl } : {}),
		...(primary ? { isbn13: primary } : {}),
		providerKey: 'hardcover',
		providerId: String(book.hardcoverId),
		...(others.length
			? {
					metadataSources: [...new Set(others)].map((isbn13) => ({
						providerKey: 'hardcover',
						providerId: String(book.hardcoverId),
						providerLabel: 'Hardcover',
						isbn10: null,
						isbn13
					}))
				}
			: {}),
		...(targetLibraryId ? { targetLibraryId } : {})
	};
}

/** A book's ISBN-13 per edition type (Hardcover's default editions). */
export type EditionIsbns = { ebook: string | null; physical: string | null; audio: string | null };

/* ── Reviewing a download BookOrbit wasn't sure about ─────────────────────── */

export type ReviewRow = { field: 'Title' | 'Author' | 'ISBN'; requested: string | null; imported: string | null; verdict: 'match' | 'mismatch' | 'unknown' };
export type DownloadReview = {
	score: number | null;
	threshold: number | null;
	/** BookOrbit's reason, e.g. "scored 30, below the 70 needed to file it automatically". */
	reason: string | null;
	rows: ReviewRow[];
	files: { name: string; format: string | null; sizeBytes: number | null }[];
	/** False when there's no library to file it into. */
	canFile: boolean;
	/** The file is gone from the Book Dock (filed or discarded elsewhere). */
	gone: boolean;
};

const FIELD_NAMES: Record<string, ReviewRow['field']> = { title: 'Title', authors: 'Author', isbn13: 'ISBN' };

export function mapReview(raw: unknown): DownloadReview {
	const r = rec(raw);
	const v = r.verification ? rec(r.verification) : null;
	return {
		score: v ? num(v.score) : null,
		threshold: v ? num(v.threshold) : null,
		reason: v ? str(v.reason) : null,
		rows: (v && Array.isArray(v.rows) ? v.rows : []).map((x) => {
			const row = rec(x);
			const verdict = str(row.verdict);
			return {
				field: FIELD_NAMES[str(row.field) ?? ''] ?? 'Title',
				requested: str(row.requested),
				imported: str(row.imported),
				verdict: verdict === 'match' || verdict === 'mismatch' ? verdict : 'unknown'
			};
		}),
		files: (Array.isArray(r.files) ? r.files : []).map((x) => {
			const f = rec(x);
			return { name: str(f.fileName) ?? 'file', format: str(f.format), sizeBytes: num(f.fileSize) };
		}),
		canFile: r.canFile !== false,
		gone: r.bookDockFileId === null || r.bookDockFileId === undefined
	};
}

/* ── Profile and diary: your reading over time ─────────────────────────────── */

export type ReadingRange = 'this_month' | 'this_year' | 'last_year' | 'all_time';

/** [from, to) for a Profile range, as ISO date strings ('' = unbounded). */
export function rangeBounds(range: ReadingRange, now = new Date()): { from: string; to: string } {
	const y = now.getFullYear();
	const iso = (d: Date) => d.toISOString();
	switch (range) {
		case 'this_month':
			return { from: iso(new Date(y, now.getMonth(), 1)), to: '' };
		case 'this_year':
			return { from: iso(new Date(y, 0, 1)), to: '' };
		case 'last_year':
			return { from: iso(new Date(y - 1, 0, 1)), to: iso(new Date(y, 0, 1)) };
		default:
			return { from: '', to: '' };
	}
}

export type ReadingStats = {
	finished: number;
	pages: number;
	/** Mean of your ratings on books finished in the range, or null. */
	avgRating: number | null;
	topGenres: { name: string; count: number }[];
	/** Finished in the range, newest first. */
	recent: MyBook[];
	reading: number;
};

const isFinished = (b: MyBook) => (b.status === 'read' || b.status === 'skimmed') && Boolean(b.finishedAt);

/** Your reading in a Profile range: what you finished, pages, ratings, genres. */
export function readingStats(books: MyBook[], range: ReadingRange, now = new Date()): ReadingStats {
	const { from, to } = rangeBounds(range, now);
	const inRange = (iso: string) => (!from || iso >= from) && (!to || iso < to);
	const done = books.filter((b) => isFinished(b) && inRange(b.finishedAt!)).sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!));
	const rated = done.filter((b) => b.myRating !== null);
	const genres = new Map<string, { name: string; count: number }>();
	for (const b of done)
		for (const g of b.genres) {
			const k = g.toLowerCase();
			const c = genres.get(k) ?? { name: g, count: 0 };
			c.count++;
			genres.set(k, c);
		}
	return {
		finished: done.length,
		pages: done.reduce((n, b) => n + (b.pages ?? 0), 0),
		avgRating: rated.length ? Math.round((rated.reduce((n, b) => n + b.myRating!, 0) / rated.length) * 10) / 10 : null,
		topGenres: [...genres.values()].sort((a, b) => b.count - a.count).slice(0, 5),
		recent: done.slice(0, 12),
		reading: books.filter((b) => b.status === 'reading' || b.status === 'rereading').length
	};
}

export type BookDiaryEntry = { what: 'Finished' | 'Started'; at: string; book: MyBook };
export type BookDiaryDay = { date: string; entries: BookDiaryEntry[] };

/** Your reading as a diary: each book you started or finished, by day, newest
 *  first (days are local dates). */
export function bookDiary(books: MyBook[]): BookDiaryDay[] {
	const entries: BookDiaryEntry[] = [];
	for (const b of books) {
		if (b.finishedAt && (b.status === 'read' || b.status === 'skimmed')) entries.push({ what: 'Finished', at: b.finishedAt, book: b });
		if (b.startedAt) entries.push({ what: 'Started', at: b.startedAt, book: b });
	}
	entries.sort((a, b) => b.at.localeCompare(a.at));
	const local = (iso: string) => {
		const d = new Date(iso);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	};
	const days: BookDiaryDay[] = [];
	for (const e of entries) {
		const date = local(e.at);
		const last = days[days.length - 1];
		if (last?.date === date) last.entries.push(e);
		else days.push({ date, entries: [e] });
	}
	return days;
}

/* ── "Because you…": what personal recommendations grow from ─────────────── */

/** The books to recommend from: ones you finished, or rated 4+, most recent
 *  first (a Hardcover id lets us look up its series and author). */
export function recommendationSeeds(books: MyBook[], max = 4): MyBook[] {
	const liked = books.filter(
		(b) => b.status === 'read' || b.status === 'skimmed' || (b.myRating !== null && b.myRating >= 4)
	);
	const when = (b: MyBook) => b.finishedAt ?? b.activeAt ?? '';
	// Loved ones first, then the most recently finished.
	return liked
		.sort((a, b) => (b.myRating ?? 3) - (a.myRating ?? 3) || when(b).localeCompare(when(a)))
		.slice(0, max);
}

/**
 * Nothing finished or loved yet? Grow from what you chose to own instead: the
 * library books you added most recently (not ones you gave up on).
 */
export function librarySeeds(books: MyBook[], max = 3): MyBook[] {
	return books
		.filter((b) => b.source === 'library' && b.status !== 'abandoned')
		.sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''))
		.slice(0, max);
}

/* Hardcover's user_books.status_id. 6 ("ignored") and anything new is skipped. */
const SHELF_STATUS: Record<number, BookReadStatus> = {
	1: 'want_to_read',
	2: 'reading',
	3: 'read',
	4: 'on_hold',
	5: 'abandoned'
};

/**
 * Your books on Hardcover (`me { user_books { … } }`) as MyBooks — what you've
 * read and rated there, for recommendations only. Ratings (half-stars) round.
 */
export function mapHardcoverShelf(raw: unknown): MyBook[] {
	if (!Array.isArray(raw)) return [];
	const out: MyBook[] = [];
	for (const r of raw) {
		const ub = rec(r);
		const status = SHELF_STATUS[num(ub.status_id) ?? 0];
		const book = rec(ub.book);
		const id = num(book.id);
		if (!status || !id) continue;
		const card = mapHardcoverBook(book);
		const rating = num(ub.rating);
		const finished = str(ub.last_read_date);
		out.push({
			key: `hc:${id}`,
			source: 'entry',
			libraryId: null,
			hardcoverId: id,
			title: card.title,
			authors: card.author ? [card.author] : [],
			coverUrl: card.coverUrl,
			year: card.year,
			status,
			myRating: rating ? Math.round(rating) : null,
			pages: null,
			progress: null,
			seriesName: null,
			seriesIndex: null,
			genres: tagNames(book.cached_tags, 'Genre', 6),
			formats: [],
			addedAt: null,
			activeAt: finished,
			startedAt: null,
			finishedAt: finished
		});
	}
	return out;
}

/** Your books plus the Hardcover shelf books Seek doesn't already have (by
 *  Hardcover id, or title + author). Your own copy's status always wins. */
export function withShelf(books: MyBook[], shelf: MyBook[]): MyBook[] {
	const ids = new Set(books.map((b) => b.hardcoverId).filter(Boolean));
	const keys = new Set(books.map((b) => bookKey(b.title, b.authors[0])));
	return [...books, ...shelf.filter((b) => !ids.has(b.hardcoverId) && !keys.has(bookKey(b.title, b.authors[0])))];
}

/** The genres you read most, weighting books you rated highly. */
export function favoriteGenres(books: MyBook[], extra: Map<string, string[]> = new Map(), max = 2): string[] {
	const counts = new Map<string, { name: string; n: number }>();
	for (const b of books) {
		if (!(b.status === 'read' || b.status === 'reading' || b.status === 'skimmed' || b.myRating)) continue;
		const weight = b.myRating !== null ? Math.max(0.5, b.myRating - 2) : 1;
		for (const g of [...b.genres, ...(extra.get(b.key) ?? [])]) {
			const k = g.toLowerCase();
			const c = counts.get(k) ?? { name: g, n: 0 };
			c.n += weight;
			counts.set(k, c);
		}
	}
	return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, max).map((c) => c.name);
}

/** Recommendations minus anything you already have (library or your list). */
export function notYours(cards: BookCard[], books: MyBook[]): BookCard[] {
	const ids = new Set(books.map((b) => b.hardcoverId).filter(Boolean));
	const keys = new Set(books.map((b) => bookKey(b.title, b.authors[0])));
	return cards.filter((c) => !ids.has(c.hardcoverId) && !keys.has(bookKey(c.title, c.author)));
}

/* ── Downloading: release search and grab (BookOrbit self-serve requests) ─── */

/** One downloadable release BookOrbit's sources (Prowlarr) found. */
export type BookRelease = {
	indexerId: number;
	guid: string;
	title: string;
	source: string;
	format: string | null;
	sizeBytes: number | null;
	seeders: number | null;
	language: string | null;
	/** BookOrbit's ranking (higher is better) and the profile tier it matched. */
	score: number;
	tierName: string | null;
	/** It doesn't fit your release profile (wrong format, too big…), in words. */
	mismatch: string | null;
	vipOnly: boolean;
	alreadyGrabbed: boolean;
};

export type ReleaseSearch = {
	releases: BookRelease[];
	/** Sources that couldn't be searched, and why ("Prowlarr: timed out"). */
	failures: string[];
	searched: number;
	/** None enabled at all — a different problem from "not found". */
	noSources: boolean;
};

/** Why a release falls outside your release profile, in words. */
export function mismatchText(raw: unknown): string | null {
	const m = rec(raw);
	const failures = Array.isArray(m.failures) ? m.failures.map(rec) : [];
	if (!raw) return null;
	const words = failures.map((f) => {
		const list = (v: unknown) => (Array.isArray(v) ? v.join('/') : String(v ?? ''));
		switch (f.code) {
			case 'format':
			case 'formatUnknown':
				return `not ${list(f.expected)}`;
			case 'language':
			case 'languageUnknown':
				return 'wrong language';
			case 'size':
			case 'sizeUnknown':
				return 'size';
			case 'seeders':
				return 'too few seeders';
			case 'bitrate':
				return 'bitrate';
			case 'fileLayout':
			case 'fileLayoutUnknown':
				return 'file layout';
			default:
				return null;
		}
	});
	const said = [...new Set(words.filter(Boolean))];
	return said.length ? said.join(', ') : 'outside your release profile';
}

export function mapRelease(raw: unknown): BookRelease {
	const r = rec(raw);
	return {
		indexerId: num(r.indexerId) ?? 0,
		guid: str(r.guid) ?? '',
		title: str(r.title) ?? 'Untitled release',
		source: str(r.indexerName) ?? 'Unknown source',
		format: str(r.format),
		sizeBytes: num(r.sizeBytes),
		seeders: num(r.seeders),
		language: str(r.language),
		score: num(r.score) ?? 0,
		tierName: str(r.tierName),
		mismatch: mismatchText(r.profileMismatch),
		vipOnly: r.vipOnly === true,
		alreadyGrabbed: r.alreadyGrabbed === true
	};
}

const FAILURE_WORDS: Record<string, string> = {
	unauthorized: 'rejected the API key',
	throttled: 'is rate-limiting',
	timeout: 'timed out',
	unreachable: "couldn't be reached",
	unsupportedMedium: "doesn't carry this kind of book",
	error: 'failed'
};

export function mapReleaseSearch(raw: unknown): ReleaseSearch {
	const r = rec(raw);
	const indexers = (Array.isArray(r.indexers) ? r.indexers : []).map(rec);
	return {
		releases: (Array.isArray(r.releases) ? r.releases : []).map(mapRelease),
		failures: indexers
			.filter((i) => i.ok === false)
			.map((i) => `${str(i.indexerName) ?? 'A source'} ${FAILURE_WORDS[str(i.failure) ?? 'error'] ?? 'failed'}`),
		searched: indexers.length,
		noSources: (num(r.enabledIndexerCount) ?? indexers.length) === 0
	};
}

/** What Automatic grabs: the best-ranked release that fits your profile and
 *  can actually be downloaded — or null, and the sheet says why. */
export function pickBestRelease(releases: BookRelease[]): BookRelease | null {
	return (
		releases
			.filter((r) => !r.mismatch && !r.vipOnly && !r.alreadyGrabbed && r.guid)
			.sort((a, b) => b.score - a.score || (b.seeders ?? -1) - (a.seeders ?? -1))[0] ?? null
	);
}

/** Why a search found nothing worth grabbing, in a sentence. */
export function emptySearchReason(s: ReleaseSearch): string {
	if (s.noSources) return 'BookOrbit has no download sources turned on (Settings → Indexers in BookOrbit).';
	const failed = s.failures.length ? ` ${s.failures.join('; ')}.` : '';
	if (!s.releases.length) return `No releases found${s.searched ? ` (searched ${s.searched} source${s.searched === 1 ? '' : 's'})` : ''}.${failed}`;
	return `Found ${s.releases.length}, but none fit your release profile — pick one yourself if you like.${failed}`;
}

/**
 * The URL to draw a cover at a given CSS width. Covers come from two places,
 * neither of which serves sized images, so both go through Seek's thumbnailer
 * (server/images.ts) at 2× for retina: BookOrbit covers via the cover proxy's
 * `?w=`, Hardcover covers via /api/books/img. Anything else is used as-is.
 */
export function coverThumb(url: string | null, cssWidth: number): string | null {
	if (!url) return null;
	const w = Math.round(cssWidth * 2);
	if (url.startsWith('/api/books/cover/')) return `${url}?w=${w}`;
	if (url.startsWith('https://assets.hardcover.app/')) {
		return `/api/books/img?u=${encodeURIComponent(url)}&w=${w}`;
	}
	return url;
}

/* ── Matching a library book to a catalog book without an id ─────────────────
   BookOrbit only records a Hardcover id once it has matched the book, and until
   then the two sides can only be joined by what the book is called. Normalise
   both so cosmetic differences don't break the match — case, punctuation, a
   subtitle after the colon, a "(Series 14)" suffix — while different books stay
   different. */
export function normTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/\(.*?\)|\[.*?\]/g, ' ') // "(Women's Murder Club 14)"
		.split(/[:–—]/)[0] // "Dune: Deluxe Edition" → "dune"
		.replace(/^(the|a|an)\s+/, '')
		.replace(/&/g, 'and')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function normAuthor(author: string | null | undefined): string {
	return (author ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

/** The join key: normalised title + first author. */
export const bookKey = (title: string, author: string | null | undefined) =>
	`${normTitle(title)}|${normAuthor(author)}`;

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Author lists arrive as plain strings or as `{name}` objects depending on the
 *  source; accept either and drop anything empty. */
export function authorNames(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((a) => (typeof a === 'string' ? a : str(rec(a).name)))
		.filter((n): n is string => Boolean(n));
}

const READ_STATUSES: BookReadStatus[] = [
	'unread',
	'want_to_read',
	'reading',
	'on_hold',
	'rereading',
	'read',
	'skimmed',
	'abandoned'
];

/** A reading fraction in 0..1. BookOrbit may report a percent (0..100) or a
 *  fraction (0..1); normalise both, and clamp. */
export function normalizeProgress(v: unknown): number | null {
	const n = num(v);
	if (n === null) return null;
	const frac = n > 1 ? n / 100 : n;
	return Math.max(0, Math.min(1, frac));
}

/** Map one BookOrbit `/books/query` item to a reading-list row. */
export function mapReadingBook(raw: unknown): ReadingBook {
	const b = rec(raw);
	const id = num(b.id) ?? 0;
	const statusRaw = str(rec(b.readStatus).status);
	const status: BookReadStatus =
		statusRaw && (READ_STATUSES as string[]).includes(statusRaw)
			? (statusRaw as BookReadStatus)
			: 'unread';
	return {
		id,
		title: str(b.title) ?? 'Untitled',
		authors: authorNames(b.authors),
		status,
		progress: normalizeProgress(b.readingProgress),
		rating: num(b.rating),
		pageCount: num(b.pageCount),
		year: num(b.publishedYear),
		seriesName: str(b.seriesName),
		seriesIndex: num(b.seriesIndex),
		coverUrl: b.hasCover ? `/api/books/cover/${id}` : null,
		hardcoverId: num(b.hardcoverId),
		genres: Array.isArray(b.genres) ? b.genres.filter((g): g is string => typeof g === 'string') : [],
		formats: [
			...new Set(
				(Array.isArray(b.files) ? b.files : [])
					.map((f) => str(rec(f).format))
					.filter((f): f is string => Boolean(f))
					.map(formatOf)
			)
		],
		addedAt: str(b.addedAt),
		statusAt: str(rec(b.readStatus).updatedAt),
		startedAt: str(rec(b.readStatus).startedAt),
		finishedAt: str(rec(b.readStatus).finishedAt)
	};
}

/** Map a Hardcover `books` query row (trending/new rails) to a discovery card. */
export function mapHardcoverBook(raw: unknown): BookCard {
	const b = rec(raw);
	const contributors = Array.isArray(b.cached_contributors) ? b.cached_contributors : [];
	const primary =
		contributors.find((c) => rec(c).primary) ?? contributors[0];
	return {
		hardcoverId: num(b.id) ?? 0,
		title: str(b.title) ?? 'Untitled',
		author: primary ? str(rec(rec(primary).author).name) : null,
		coverUrl: str(rec(b.image).url),
		year: num(b.release_year),
		rating: num(b.rating)
	};
}

/** Tag names from Hardcover's `cached_tags` for one category (Genre, Mood, …),
 *  deduplicated case-insensitively — the same tag often appears several ways. */
function tagNames(cached: unknown, category: string, max: number): string[] {
	const list = rec(cached)[category];
	if (!Array.isArray(list)) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of list) {
		const name = str(rec(t).tag);
		if (!name || seen.has(name.toLowerCase())) continue;
		seen.add(name.toLowerCase());
		out.push(name);
		if (out.length >= max) break;
	}
	return out;
}

/** Map a Hardcover `books_by_pk` result to the book sheet's detail. */
export function mapHardcoverDetail(raw: unknown): BookDetail {
	const b = rec(raw);
	const firstSeries = Array.isArray(b.book_series) ? rec(b.book_series[0]) : {};
	const seriesName = str(rec(firstSeries.series).name);
	return {
		...mapHardcoverBook(raw),
		subtitle: str(b.subtitle),
		description: str(b.description),
		pages: num(b.pages),
		ratingsCount: num(b.ratings_count),
		readers: num(b.users_count),
		genres: tagNames(b.cached_tags, 'Genre', 6),
		moods: tagNames(b.cached_tags, 'Mood', 4),
		series: seriesName ? { name: seriesName, position: num(firstSeries.position) } : null
	};
}

/** Map a Hardcover search hit `document` to a discovery card. */
export function mapHardcoverHit(raw: unknown): BookCard {
	const d = rec(raw);
	const names = Array.isArray(d.author_names) ? d.author_names : [];
	return {
		hardcoverId: Number(str(d.id) ?? num(d.id) ?? 0) || 0,
		title: str(d.title) ?? 'Untitled',
		author: str(names[0]),
		coverUrl: str(rec(d.image).url),
		year: num(d.release_year),
		rating: num(d.rating)
	};
}
