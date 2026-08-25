/**
 * Floppy API client. Server-only — $lib/server is unimportable from client code,
 * which is what keeps FLOPPY_TOKEN out of the browser bundle (spec §2).
 *
 * Verified against openapi.yaml on build v26.8.20. Floppy ships daily; if calls
 * start failing, re-read GET /api/openapi.yaml before assuming a bug here.
 */
import { FLOPPY_URL, FLOPPY_TOKEN } from './env';

export class FloppyError extends Error {
	constructor(
		readonly status: number,
		readonly body: string,
		readonly method: string,
		readonly path: string
	) {
		super(`Floppy ${method} ${path} → ${status}: ${body.slice(0, 400)}`);
		this.name = 'FloppyError';
	}
}

/** Thrown when the request never reached Floppy, so nothing was written. */
export class FloppyUnreachable extends Error {
	constructor(readonly cause: unknown, readonly method: string, readonly path: string) {
		super(`Floppy ${method} ${path} unreachable: ${cause}`);
		this.name = 'FloppyUnreachable';
	}
}

type Req = {
	method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
	query?: Record<string, string | number | boolean | undefined | (string | number)[]>;
	body?: unknown;
	/** Skip auth header — only /api/v1/info/ needs this. */
	anonymous?: boolean;
	timeoutMs?: number;
};

function buildQuery(query: Req['query']): string {
	if (!query) return '';
	const p = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v === undefined) continue;
		// Array params (status, platform, tag) are repeated keys, per the contract.
		if (Array.isArray(v)) for (const item of v) p.append(k, String(item));
		else p.append(k, String(v));
	}
	const s = p.toString();
	return s ? `?${s}` : '';
}

/**
 * Concurrency limiter.
 *
 * Seek fans out up to 88 episode-title lookups when rebuilding the watchlist.
 * Floppy survives that — measured, no errors — but it takes ~1.4s on its own and
 * ~3.7s alongside the 200-row list query, and while it is in flight it is
 * competing with whatever the user is actually waiting for. Capping in-flight
 * requests keeps a burst from monopolising Floppy.
 */
const MAX_IN_FLIGHT = 10;
let active = 0;
const waiting: (() => void)[] = [];

async function acquire(): Promise<void> {
	if (active < MAX_IN_FLIGHT) {
		active++;
		return;
	}
	await new Promise<void>((resolve) => waiting.push(resolve));
	active++;
}

function release(): void {
	active--;
	waiting.shift()?.();
}

export async function floppy<T = unknown>(path: string, opts: Req = {}): Promise<T> {
	const { method = 'GET', query, body, anonymous = false, timeoutMs = 15_000 } = opts;
	const url = `${FLOPPY_URL()}${path}${buildQuery(query)}`;

	const headers: Record<string, string> = { Accept: 'application/json' };
	if (!anonymous) headers['X-API-Key'] = FLOPPY_TOKEN();
	if (body !== undefined) headers['Content-Type'] = 'application/json';

	let res: Response;
	await acquire();
	try {
		res = await fetch(url, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (cause) {
		// Distinguished from FloppyError deliberately: callers that must not retry
		// writes (§12.3) need to know whether the request could have landed.
		// A connect-stage failure means it did not. A timeout is ambiguous and is
		// NOT treated as unreachable — see markEpisodeWatched.
		throw new FloppyUnreachable(cause, method, path);
	} finally {
		release();
	}

	if (!res.ok) throw new FloppyError(res.status, await res.text().catch(() => ''), method, path);
	if (res.status === 204) return undefined as T;

	const text = await res.text();
	if (!text) return undefined as T;
	return JSON.parse(text) as T;
}
