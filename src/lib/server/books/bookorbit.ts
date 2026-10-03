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
 * Read-only by design for now: any mutation (status change, grab, upload) gets
 * its own deliberate function — this module never touches a library on its own.
 */
import { BOOKORBIT_URL } from '$lib/server/env';
import { TTLCache } from '$lib/server/cache';
import { bookorbitLogin, scopeId, scopeKey, NotLinkedError, type BookOrbitLogin } from '$lib/server/userctx';
import { mapReadingBook, type ReadingBook, type BookReadStatus } from '$lib/books';

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

type ReqInit = { method?: string; body?: unknown; timeoutMs?: number };

/** Authenticated BookOrbit request. Retries once on a 401 by re-logging in, so a
 *  server-side token expiry is invisible to the caller. */
async function bo<T>(path: string, init: ReqInit = {}): Promise<T> {
	const send = async (token: string) =>
		fetch(`${api()}${path}`, {
			method: init.method ?? 'GET',
			headers: {
				Accept: 'application/json',
				Authorization: `Bearer ${token}`,
				...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {})
			},
			body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
			signal: AbortSignal.timeout(init.timeoutMs ?? 15_000)
		});

	let res = await send(await accessToken());
	if (res.status === 401) {
		sessions.delete(scopeId());
		res = await send(await accessToken());
	}
	if (!res.ok) throw new Error(`BookOrbit ${path} -> HTTP ${res.status}`);
	return res.json() as Promise<T>;
}

/* The library isn't huge and a per-status query filter wasn't exposed, so fetch
   the whole list once and slice it in Seek. Cached briefly, per user (each
   person's statuses differ); a reading change on a device shows up on the next
   refresh. */
const listCache = new TTLCache<ReadingBook[]>(60_000);
const PAGE = 500;

/** Every owned book as a reading-list row, with *this person's* status. */
export async function getAllBooks(): Promise<ReadingBook[]> {
	const key = scopeKey('books:all');
	const hit = listCache.get(key);
	if (hit) return hit;

	const first = await bo<{ items: unknown[]; total: number }>('/books/query', {
		method: 'POST',
		body: { limit: PAGE, page: 1 }
	});
	const items = [...first.items];
	// Page through if the library is larger than one page.
	for (let page = 2; items.length < first.total && page < 50; page++) {
		const next = await bo<{ items: unknown[] }>('/books/query', {
			method: 'POST',
			body: { limit: PAGE, page }
		});
		if (!next.items.length) break;
		items.push(...next.items);
	}

	const rows = items.map(mapReadingBook);
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

/** Drop the current user's cached list (after a status change) and, with
 *  `session`, their BookOrbit session too (after they relink the account). */
export function dropBooksCache(opts: { session?: boolean } = {}): void {
	listCache.delete(scopeKey('books:all'));
	if (opts.session) sessions.delete(scopeId());
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

/** Headline reading stats for the Profile books section. */
export const getStatsSummary = () => bo<StatsSummary>('/user-statistics/summary');

export type Library = { id: number; name: string };

/** The libraries this person can see — where their uploads and downloads can land. */
export async function listLibraries(): Promise<Library[]> {
	const raw = await bo<{ id?: unknown; name?: unknown }[]>('/libraries');
	return raw
		.filter((l) => typeof l.id === 'number')
		.map((l) => ({ id: l.id as number, name: typeof l.name === 'string' ? l.name : `Library ${l.id}` }));
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
