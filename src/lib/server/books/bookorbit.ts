/**
 * BookOrbit server client — the self-hosted book library/reading backend.
 *
 * Per person. Reading status, progress, goals and stats are per-account in
 * BookOrbit, so Seek calls it *as the signed-in user* with their own login
 * (userctx.bookorbitLogin — the owner falls back to the env login; a member
 * never does). Each user gets their own session and their own cached list.
 *
 * Auth is a session (no static API key): log in, cache the short-lived access
 * token, re-login when it expires (stateless — simpler and sturdier than storing
 * a rotating refresh token). Tokens never leave the server.
 *
 * Writes are deliberate, one function each: setReadStatus (your own reading
 * state) and requestBook/cancelRequest (asking BookOrbit to fetch a book — its
 * own approval rules and automation decide what happens next). Never a book's
 * metadata or files.
 */
import { BOOKORBIT_URL } from '$lib/server/env';
import { TTLCache } from '$lib/server/cache';
import { invalidate } from '$lib/server/memo';
import { bookorbitLogin, scopeId, scopeKey, NotLinkedError, type BookOrbitLogin } from '$lib/server/userctx';
import {
	mapReadingBook,
	mapBookRequest,
	bookRequestBody,
	type ReadingBook,
	type BookReadStatus,
	type BookCard,
	type BookRequest,
	type RequestMediaKind
} from '$lib/books';

/** A BookOrbit instance exists. Whether *this person* is linked is separate. */
export const bookorbitConfigured = () => Boolean(BOOKORBIT_URL());

/** BookOrbit exists and the current user has a login for it. */
export const bookorbitLinked = () => bookorbitConfigured() && bookorbitLogin() !== null;

const api = () => `${BOOKORBIT_URL()}/api/v1`;

/* One cached access token per user. Remembering whose username it was for means
   a relinked account re-logs in instead of reusing the old session. Re-login a
   little before the real expiry so a request never races the cutover. */
type Session = { token: string; exp: number; username: string };
const sessions = new Map<number, Session>();
const EXPIRY_SKEW_MS = 30_000;

function myLogin(): BookOrbitLogin {
	const login = bookorbitLogin();
	if (!login) throw new NotLinkedError('bookorbit');
	return login;
}

async function login(creds: BookOrbitLogin): Promise<Session> {
	const res = await fetch(`${api()}/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ username: creds.username, password: creds.password }),
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new Error(`BookOrbit login failed: HTTP ${res.status}`);
	const d = (await res.json()) as { accessToken?: string; accessTokenExpiresAt?: string };
	if (!d.accessToken) throw new Error('BookOrbit login returned no access token');
	const exp = d.accessTokenExpiresAt ? new Date(d.accessTokenExpiresAt).getTime() : Date.now() + 60_000;
	return { token: d.accessToken, exp, username: creds.username };
}

async function accessToken(): Promise<string> {
	const creds = myLogin();
	const who = scopeId();
	const s = sessions.get(who);
	if (s && s.username === creds.username && s.exp - EXPIRY_SKEW_MS > Date.now()) return s.token;
	const fresh = await login(creds);
	sessions.set(who, fresh);
	return fresh.token;
}

type ReqInit = { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number };

/** A refusal from BookOrbit, carrying its own explanation (it writes good ones —
 *  "Pick a destination library…") so the UI can show it instead of a status code. */
export class BookOrbitError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly code: string | null = null
	) {
		super(message);
	}
}

async function refusal(path: string, res: Response): Promise<BookOrbitError> {
	const body = (await res.json().catch(() => null)) as { message?: unknown; code?: unknown } | null;
	const msg = Array.isArray(body?.message) ? body.message.join('; ') : body?.message;
	return new BookOrbitError(
		res.status,
		typeof msg === 'string' && msg ? msg : `BookOrbit ${path} -> HTTP ${res.status}`,
		typeof body?.code === 'string' ? body.code : null
	);
}

/** Authenticated BookOrbit request. Retries once on a 401 by re-logging in, so a
 *  server-side token expiry is invisible to the caller. */
async function bo<T>(path: string, init: ReqInit = {}): Promise<T> {
	// FormData goes as-is (fetch sets the multipart boundary); anything else is JSON.
	const form = init.body instanceof FormData;
	const send = async (token: string) =>
		fetch(`${api()}${path}`, {
			method: init.method ?? 'GET',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${token}`,
				...(init.body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}),
				...init.headers
			},
			body: form ? (init.body as FormData) : init.body !== undefined ? JSON.stringify(init.body) : undefined,
			signal: AbortSignal.timeout(init.timeoutMs ?? 15_000)
		});

	let res = await send(await accessToken());
	if (res.status === 401) {
		sessions.delete(scopeId());
		res = await send(await accessToken());
	}
	if (!res.ok) throw await refusal(path, res);
	if (res.status === 204) return undefined as T;
	// A DELETE may answer with an empty body; anything else must be JSON.
	return (init.method === 'DELETE' ? res.json().catch(() => undefined) : res.json()) as Promise<T>;
}

/* The library isn't huge and a per-status query filter wasn't exposed, so fetch
   the whole list once and slice it in Seek. Cached briefly, per user (each
   person's statuses differ); a reading change on a device shows up on the next
   refresh. */
const listCache = new TTLCache<ReadingBook[]>(60_000);
/* BookOrbit's /books/query takes `pagination: { page (0-based), size ≤ 200 }`
   and silently strips any other key (verified against its zod schema — `limit`
   and a top-level `page` are ignored, which returns page 0 every time). */
const PAGE_SIZE = 200;
const MAX_PAGES = 50;

/** Every owned book as a reading-list row, with *this person's* status. */
export async function getAllBooks(): Promise<ReadingBook[]> {
	const key = scopeKey('books:all');
	const hit = listCache.get(key);
	if (hit) return hit;

	const items: unknown[] = [];
	let total = Infinity;
	for (let page = 0; items.length < total && page < MAX_PAGES; page++) {
		const res = await bo<{ items: unknown[]; total: number }>('/books/query', {
			method: 'POST',
			body: { pagination: { page, size: PAGE_SIZE } }
		});
		total = res.total;
		if (!res.items.length) break;
		items.push(...res.items);
	}

	/* A book added or removed mid-fetch can shift the pages; never hand the UI
	   the same book twice. */
	const seen = new Set<number>();
	const rows = items.map(mapReadingBook).filter((b) => !seen.has(b.id) && seen.add(b.id));
	listCache.set(key, rows);
	return rows;
}

/** Reading-list rows filtered to the given statuses (all when omitted). */
export async function getReadingList(statuses?: BookReadStatus[]): Promise<ReadingBook[]> {
	const all = await getAllBooks();
	if (!statuses?.length) return all;
	const want = new Set(statuses);
	return all.filter((b) => want.has(b.status));
}

/**
 * Set *your* reading status on a book you own (want to read, reading, read, …).
 * Per-user in BookOrbit — it changes your state, never the book or anyone
 * else's. Drops your cached list and Profile snapshot so both reflect it.
 */
export async function setReadStatus(bookId: number, status: BookReadStatus): Promise<BookReadStatus> {
	const res = await bo<{ status?: string }>(`/books/${bookId}/status`, {
		method: 'PATCH',
		body: { status }
	});
	dropBooksCache();
	invalidate('books:snapshot');
	return (res.status as BookReadStatus) ?? status;
}

/** Drop the current user's cached list (after a status change) and, with
 *  `session`, their BookOrbit session too (after they relink the account). */
export function dropBooksCache(opts: { session?: boolean } = {}): void {
	listCache.delete(scopeKey('books:all'));
	if (opts.session) sessions.delete(scopeId());
}

/** BookOrbit's address changed: every session and cached list belongs to the old one. */
export function forgetBookOrbitSessions(): void {
	sessions.clear();
	listCache.clear();
}

export type ReadingGoal = { goalBooks: number; completedBooks: number; year: number };
export type StatsSummary = {
	trackedBooks: number;
	startedBooks: number;
	inProgressBooks: number;
	completedBooks: number;
	meanProgressPercent: number;
};

/** This year's reading goal (books). */
export const getReadingGoal = () => bo<ReadingGoal>('/dashboard/widgets/reading-goal');

/**
 * Set your yearly goal (books). BookOrbit keeps it in your dashboard settings,
 * and replaces that object whole on save — so read it and change just the goal,
 * leaving your BookOrbit dashboard layout as it was.
 */
export async function setReadingGoal(books: number): Promise<ReadingGoal> {
	const me = await bo<{ settings?: { dashboardConfig?: Record<string, unknown> } }>('/auth/me');
	const dashboardConfig = { ...(me.settings?.dashboardConfig ?? {}), readingGoal: books };
	await bo<unknown>('/users/me/settings', { method: 'PATCH', body: { settings: { dashboardConfig } } });
	invalidate('books:snapshot');
	return getReadingGoal();
}

/** Headline reading stats for the Profile books section. */
export const getStatsSummary = () => bo<StatsSummary>('/user-statistics/summary');

/* ── Profile → Reading: the per-person numbers BookOrbit keeps ─────────────── */

export type ReadingStreak = { current: number; longest: number; lastSevenDays: boolean[] };
export type MonthlyChallenge = {
	title: string;
	description: string;
	progress: number;
	target: number;
	completed: boolean;
};
export type Achievement = { name: string; description: string; awardedAt: string };
export type AchievementSummary = { earned: number; available: number; recent: Achievement[] };
export type ReadingSnapshot = {
	goal: ReadingGoal | null;
	streak: ReadingStreak | null;
	summary: StatsSummary | null;
	challenge: MonthlyChallenge | null;
	achievements: AchievementSummary | null;
};

type RawObj = Record<string, unknown>;
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const s = (v: unknown) => (typeof v === 'string' ? v : '');

export function toStreak(raw: unknown): ReadingStreak {
	const r = (raw ?? {}) as RawObj;
	return {
		current: n(r.currentStreak),
		longest: n(r.longestStreak),
		lastSevenDays: Array.isArray(r.lastSevenDays) ? r.lastSevenDays.map(Boolean).slice(0, 7) : []
	};
}

export function toChallenge(raw: unknown): MonthlyChallenge | null {
	const r = (raw ?? {}) as RawObj;
	if (!s(r.title)) return null;
	return {
		title: s(r.title),
		description: s(r.description),
		progress: n(r.progress),
		target: Math.max(1, n(r.target)),
		completed: Boolean(r.completed)
	};
}

/** Earned/available totals and the three most recently earned. */
export function toAchievements(raw: unknown): AchievementSummary {
	const r = (raw ?? {}) as RawObj;
	const all = (Array.isArray(r.categories) ? r.categories : []).flatMap((c) =>
		Array.isArray((c as RawObj).achievements) ? ((c as RawObj).achievements as RawObj[]) : []
	);
	const recent = all
		.filter((a) => a.earned && s(a.awardedAt))
		.sort((a, b) => s(b.awardedAt).localeCompare(s(a.awardedAt)))
		.slice(0, 3)
		.map((a) => ({ name: s(a.name), description: s(a.description), awardedAt: s(a.awardedAt) }));
	return { earned: n(r.totalEarned), available: n(r.totalAvailable), recent };
}

/** Everything Profile → Reading shows, for the signed-in person. Each widget
 *  stands alone — one failing never blanks the others. */
export async function getReadingSnapshot(): Promise<ReadingSnapshot> {
	const safe = <T>(p: Promise<T>) => p.catch(() => null);
	const [goal, streak, summary, challenge, achievements] = await Promise.all([
		safe(getReadingGoal()),
		safe(bo<unknown>('/dashboard/widgets/reading-streak').then(toStreak)),
		safe(getStatsSummary()),
		safe(bo<unknown>('/dashboard/widgets/monthly-challenge').then(toChallenge)),
		safe(bo<unknown>('/achievements').then(toAchievements))
	]);
	return { goal, streak, summary, challenge, achievements };
}

export type Library = { id: number; name: string };

/** The libraries this person can see — where their uploads and downloads can land. */
export async function listLibraries(): Promise<Library[]> {
	const raw = await bo<{ id?: unknown; name?: unknown }[]>('/libraries');
	return raw
		.filter((l) => typeof l.id === 'number')
		.map((l) => ({ id: l.id as number, name: typeof l.name === 'string' ? l.name : `Library ${l.id}` }));
}

/* ── Requests ─────────────────────────────────────────────────────────────── */

/** Where a request from this person lands: their linked library, else the only
 *  library there is. Null when that's ambiguous — BookOrbit then either queues
 *  it for an approver to route, or says a destination is needed. */
async function requestDestination(): Promise<number | null> {
	const mine = myLogin().libraryId;
	if (mine) return mine;
	const libs = await listLibraries().catch(() => []);
	return libs.length === 1 ? libs[0].id : null;
}

/**
 * Ask BookOrbit to get a book. Filed as *you*, so its rules apply as they would
 * in its own UI: queued for approval, or — if your account auto-approves and
 * automation is on — searched and downloaded straight away. A book someone
 * already asked for just adds you to that request.
 */
export async function requestBook(
	book: Pick<BookCard, 'hardcoverId' | 'title' | 'author' | 'coverUrl' | 'year'>,
	mediaKind: RequestMediaKind
): Promise<{ request: BookRequest; joined: boolean }> {
	const res = await bo<{ request: unknown; subscribed?: boolean }>('/book-requests', {
		method: 'POST',
		body: bookRequestBody(book, mediaKind, await requestDestination())
	});
	requestCache.delete(scopeKey('books:requests'));
	return { request: mapBookRequest(res.request), joined: Boolean(res.subscribed) };
}

/* Requests move on their own (search → download → import), so the list is only
   cached long enough to serve one screen's worth of sheet opens. */
const requestCache = new TTLCache<BookRequest[]>(20_000);

/** Your requests, newest first (the ones you've hidden in BookOrbit left out). */
export async function listMyRequests(): Promise<BookRequest[]> {
	const key = scopeKey('books:requests');
	const hit = requestCache.get(key);
	if (hit) return hit;
	const res = await bo<{ items: unknown[] }>('/book-requests?limit=100&sortBy=createdAt&sortDir=desc');
	const rows = res.items.map(mapBookRequest);
	requestCache.set(key, rows);
	return rows;
}

/** Call off one of your requests (stops a download that's under way). */
export async function cancelRequest(id: number): Promise<BookRequest> {
	const out = mapBookRequest(await bo<unknown>(`/book-requests/${id}/cancel`, { method: 'POST' }));
	requestCache.delete(scopeKey('books:requests'));
	return out;
}

/* ── Uploads (what the old bookshelf app did) ─────────────────────────────────
   BookOrbit's resumable upload sessions: open one for a file, send it in
   chunks at stated offsets, then complete — BookOrbit validates, files and
   imports it. Seek relays the chunks so the browser never holds a BookOrbit
   token. Uploads land where *you* may put them, under your own account. */

export type UploadDestination = { id: number; name: string; formats: string[] };
export type UploadOptions = {
	maxBytes: number;
	/** What BookOrbit accepts, lower-case extensions. */
	formats: string[];
	libraries: UploadDestination[];
	/** BookOrbit's Book Dock: an inbox to review metadata before filing. */
	dock: boolean;
	/** The library Seek will pick by default (your linked one, or the only one). */
	defaultLibraryId: number | null;
};

export type UploadTarget = { kind: 'library'; libraryId: number } | { kind: 'book_dock' };
export type UploadStatus = 'receiving' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'expired';
export type UploadSession = {
	id: string;
	filename: string;
	size: number;
	received: number;
	status: UploadStatus;
	error: string | null;
	bookId: number | null;
};

export function toUploadSession(raw: unknown): UploadSession {
	const r = (raw ?? {}) as RawObj;
	return {
		id: s(r.id),
		filename: s(r.filename),
		size: n(r.sizeBytes),
		received: n(r.receivedBytes),
		status: (s(r.status) || 'receiving') as UploadStatus,
		error: s(r.errorMessage) || null,
		bookId: typeof r.bookId === 'number' ? r.bookId : null
	};
}

/** What you can upload and where to. */
export async function uploadOptions(): Promise<UploadOptions> {
	const raw = await bo<RawObj>('/uploads/capabilities');
	const libs = (Array.isArray(raw.libraries) ? raw.libraries : []) as RawObj[];
	const libraries = raw.canUploadToLibrary
		? libs.map((l) => ({
				id: n(l.id),
				name: s(l.name) || `Library ${n(l.id)}`,
				formats: Array.isArray(l.allowedFormats) ? (l.allowedFormats as string[]) : []
			}))
		: [];
	const mine = myLogin().libraryId;
	const defaultLibraryId = libraries.find((l) => l.id === mine)?.id ?? (libraries.length === 1 ? libraries[0].id : null);
	return {
		maxBytes: n(raw.maxFileSizeBytes),
		formats: Array.isArray(raw.supportedFormats) ? (raw.supportedFormats as string[]) : [],
		libraries,
		dock: Boolean(raw.canUseBookDock),
		defaultLibraryId
	};
}

/** Open an upload session for one file. The key makes a retried "start" (a
 *  flaky phone connection) resume the same session instead of opening two. */
export async function startUpload(file: {
	filename: string;
	size: number;
	idempotencyKey: string;
	target: UploadTarget;
}): Promise<UploadSession> {
	return toUploadSession(
		await bo<unknown>('/uploads', {
			method: 'POST',
			body: { filename: file.filename, sizeBytes: file.size, idempotencyKey: file.idempotencyKey, target: file.target }
		})
	);
}

/** Send the bytes at `offset`. BookOrbit refuses a chunk at the wrong offset
 *  or one whose checksum doesn't match, so nothing is silently corrupted. */
export async function sendChunk(id: string, offset: number, bytes: Uint8Array, filename: string): Promise<UploadSession> {
	const { createHash } = await import('node:crypto');
	const form = new FormData();
	form.append('file', new Blob([bytes as Uint8Array<ArrayBuffer>]), filename);
	return toUploadSession(
		await bo<unknown>(`/uploads/${id}/chunks`, {
			method: 'POST',
			body: form,
			headers: {
				'upload-offset': String(offset),
				'upload-checksum': createHash('sha256').update(bytes).digest('hex')
			},
			timeoutMs: 120_000
		})
	);
}

/** All bytes are in: BookOrbit checks the file and starts importing it. */
export async function finishUpload(id: string): Promise<UploadSession> {
	const out = toUploadSession(await bo<unknown>(`/uploads/${id}/complete`, { method: 'POST', timeoutMs: 120_000 }));
	dropBooksCache();
	return out;
}

/** Where an upload is (importing finishes in the background after complete). */
export async function uploadStatus(id: string): Promise<UploadSession> {
	const out = toUploadSession(await bo<unknown>(`/uploads/${id}`));
	if (out.status === 'completed') dropBooksCache();
	return out;
}

/** Abandon an upload (BookOrbit discards what it received). */
export async function cancelUpload(id: string): Promise<void> {
	await bo<unknown>(`/uploads/${id}`, { method: 'DELETE' });
}

/* ── Shelves (BookOrbit collections) ──────────────────────────────────────────
   Your own named shelves of library books — "Beach reads", "Book club". They're
   per person in BookOrbit (and can sync to a Kobo); Seek manages yours. */

export type Shelf = { id: number; name: string; count: number };
/** A shelf, and whether a given book is on it. */
export type ShelfMembership = Shelf & { has: boolean };

/** BookOrbit wants an icon name (its UI uses lucide icons); this one is a shelf. */
const SHELF_ICON = 'BookMarked';

export function toShelf(raw: unknown): Shelf {
	const r = (raw ?? {}) as RawObj;
	return { id: n(r.id), name: s(r.name) || 'Shelf', count: n(r.bookCount) };
}

/** Book collections you own, in your order. Shared ones others made are left
 *  out — you can't change those. */
export async function listShelves(): Promise<Shelf[]> {
	const raw = await bo<RawObj[]>('/collections');
	return raw
		.filter((c) => (c.mediaType ?? 'books') === 'books' && c.isOwner !== false)
		.sort((a, b) => n(a.displayOrder) - n(b.displayOrder))
		.map(toShelf);
}

/** Your shelves, each marked with whether this book is on it. */
export async function shelvesFor(bookId: number): Promise<ShelfMembership[]> {
	const raw = await bo<RawObj[]>('/collections/membership', { method: 'POST', body: { bookIds: [bookId] } });
	return raw
		.filter((c) => (c.mediaType ?? 'books') === 'books')
		.sort((a, b) => n(a.displayOrder) - n(b.displayOrder))
		.map((c) => ({ ...toShelf(c), has: n(c.memberCount) > 0 }));
}

export async function createShelf(name: string): Promise<Shelf> {
	return toShelf(await bo<unknown>('/collections', { method: 'POST', body: { name, icon: SHELF_ICON } }));
}

export async function renameShelf(id: number, name: string): Promise<Shelf> {
	return toShelf(await bo<unknown>(`/collections/${id}`, { method: 'PATCH', body: { name } }));
}

/** Delete a shelf. The books stay in the library; only the shelf goes. */
export async function deleteShelf(id: number): Promise<void> {
	await bo<unknown>(`/collections/${id}`, { method: 'DELETE' });
}

/** Put a book on a shelf, or take it off. */
export async function shelveBook(shelfId: number, bookId: number, on: boolean): Promise<void> {
	await bo<unknown>(`/collections/${shelfId}/books`, { method: on ? 'POST' : 'DELETE', body: { bookIds: [bookId] } });
}

/** The books on a shelf, as reading-list rows (with your status). */
export async function shelfBooks(id: number): Promise<ReadingBook[]> {
	// Pages of at most 100 (BookOrbit's cap), 0-based.
	const items: unknown[] = [];
	let total = Infinity;
	for (let page = 0; items.length < total && page < 20; page++) {
		const res = await bo<{ items?: unknown[]; total?: number }>(`/collections/${id}/books?page=${page}&size=100`);
		total = res.total ?? 0;
		if (!res.items?.length) break;
		items.push(...res.items);
	}
	const seen = new Set<number>();
	return items.map(mapReadingBook).filter((b) => !seen.has(b.id) && seen.add(b.id));
}

/* ── Send to Kindle (BookOrbit's email-to-device) ─────────────────────────────
   Your devices are the email recipients you set up in BookOrbit (a Kindle's
   @kindle.com address, a Kobo, a person). BookOrbit picks the right format,
   converts if it must, and mails it. */

export type Device = { id: number; name: string; kind: string | null; isDefault: boolean };
export type SendState = { status: 'pending' | 'sent' | 'failed'; to: string; error: string | null; at: string };

export async function listDevices(): Promise<Device[]> {
	const raw = await bo<RawObj[]>('/email/recipients');
	return raw
		.map((r) => ({ id: n(r.id), name: s(r.name) || s(r.email), kind: s(r.deviceType) || null, isDefault: Boolean(r.isDefault) }))
		.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** The last time this book was sent, and how that went. */
export async function lastSend(bookId: number): Promise<SendState | null> {
	const raw = await bo<RawObj[] | { items?: RawObj[] }>(`/email/log?bookId=${bookId}&size=1`);
	const row = (Array.isArray(raw) ? raw : (raw.items ?? []))[0];
	if (!row) return null;
	const status = s(row.status);
	return {
		status: status === 'sent' || status === 'failed' ? status : 'pending',
		to: s(row.toName) || s(row.toEmail),
		error: s(row.errorMessage) || null,
		at: s(row.sentAt) || s(row.createdAt)
	};
}

/** Queue the book to one of your devices. */
export async function sendToDevice(bookId: number, deviceId: number): Promise<void> {
	await bo<unknown>('/email/send', { method: 'POST', body: { bookIds: [bookId], recipientIds: [deviceId] } });
}

/** Raw cover bytes for a book, proxied to the browser (covers are auth-gated).
 *  Returns the upstream Response so the route can stream it with its headers. */
export async function fetchCover(id: number): Promise<Response> {
	const token = await accessToken();
	return fetch(`${api()}/books/${id}/cover`, {
		headers: { Authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(15_000)
	});
}
