/**
 * BookOrbit server client — the self-hosted book library/reading backend.
 *
 * Auth is a session (no static API key): we log in once with a service account's
 * username + password, cache the short-lived access token, and re-login when it
 * expires (stateless — simpler and more robust than storing a rotating refresh
 * token). The token never leaves the server.
 *
 * Read-only by design for now: Seek only *reads* the library here. Any mutation
 * (status change, grab, upload) will be added deliberately behind its own
 * function — this module must never touch the user's library on its own.
 */
import { BOOKORBIT_URL, BOOKORBIT_USER, BOOKORBIT_PASSWORD } from '$lib/server/env';
import { TTLCache } from '$lib/server/cache';
import { mapReadingBook, type ReadingBook, type BookReadStatus } from '$lib/books';

export const bookorbitConfigured = () =>
	Boolean(BOOKORBIT_URL() && BOOKORBIT_USER() && BOOKORBIT_PASSWORD());

const api = () => `${BOOKORBIT_URL()}/api/v1`;

/* One cached access token for the whole process. Re-login a little before the
   real expiry so a request never races the cutover. */
let session: { token: string; exp: number } | null = null;
const EXPIRY_SKEW_MS = 30_000;

async function login(): Promise<{ token: string; exp: number }> {
	const res = await fetch(`${api()}/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
		body: JSON.stringify({ username: BOOKORBIT_USER(), password: BOOKORBIT_PASSWORD() }),
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new Error(`BookOrbit login failed: HTTP ${res.status}`);
	const d = (await res.json()) as { accessToken?: string; accessTokenExpiresAt?: string };
	if (!d.accessToken) throw new Error('BookOrbit login returned no access token');
	const exp = d.accessTokenExpiresAt ? new Date(d.accessTokenExpiresAt).getTime() : Date.now() + 60_000;
	return { token: d.accessToken, exp };
}

async function accessToken(): Promise<string> {
	if (session && session.exp - EXPIRY_SKEW_MS > Date.now()) return session.token;
	session = await login();
	return session.token;
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
		session = null;
		res = await send(await accessToken());
	}
	if (!res.ok) throw new Error(`BookOrbit ${path} -> HTTP ${res.status}`);
	return res.json() as Promise<T>;
}

/* The library isn't huge and a per-status query filter wasn't exposed, so fetch
   the whole list once and slice it in Seek. Cached briefly; a reading change on a
   device shows up on the next refresh. */
const listCache = new TTLCache<ReadingBook[]>(60_000);
const LIST_KEY = 'all';
const PAGE = 500;

/** Every owned book as a reading-list row. */
export async function getAllBooks(): Promise<ReadingBook[]> {
	const hit = listCache.get(LIST_KEY);
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
	listCache.set(LIST_KEY, rows);
	return rows;
}

/** Reading-list rows filtered to the given statuses (all when omitted). */
export async function getReadingList(statuses?: BookReadStatus[]): Promise<ReadingBook[]> {
	const all = await getAllBooks();
	if (!statuses?.length) return all;
	const want = new Set(statuses);
	return all.filter((b) => want.has(b.status));
}

/** Drop the cached list after a mutation (none write yet, but the hook is here). */
export function dropBooksCache(): void {
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

/** Headline reading stats for the Profile books section. */
export const getStatsSummary = () => bo<StatsSummary>('/user-statistics/summary');

/** Raw cover bytes for a book, proxied to the browser (covers are auth-gated).
 *  Returns the upstream Response so the route can stream it with its headers. */
export async function fetchCover(id: number): Promise<Response> {
	const token = await accessToken();
	return fetch(`${api()}/books/${id}/cover`, {
		headers: { Authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(15_000)
	});
}
