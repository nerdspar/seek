/**
 * Standalone Floppy API client for the MCP server.
 *
 * A deliberate copy of the essentials from Seek's own `src/lib/server/floppy.ts`
 * rather than an import: that file resolves SvelteKit's `$env/dynamic/private`
 * and `$lib` aliases, which only exist inside the SvelteKit build. This server
 * runs as a plain Node process launched by Claude Desktop, so it reads its
 * configuration straight from `process.env` and has no framework underneath it.
 *
 * Everything here talks to the same Floppy REST API Seek drives; the field-level
 * lessons live in ../../docs/floppy-api-notes.md and are worth reading before
 * changing any path below.
 */

/** Trailing slashes matter — every Floppy path is written absolute. */
function baseUrl(): string {
	const u = process.env.FLOPPY_URL;
	if (!u) {
		throw new Error(
			'FLOPPY_URL is not set. Point it at your Floppy instance as this machine can ' +
				'reach it, e.g. http://192.168.1.10:8007 (see mcp/README.md).'
		);
	}
	return u.replace(/\/+$/, '');
}

function token(): string {
	const t = process.env.FLOPPY_TOKEN;
	if (!t) {
		throw new Error(
			'FLOPPY_TOKEN is not set. Get it from Floppy → Settings → Integrations → API ' +
				'Token (see mcp/README.md).'
		);
	}
	return t;
}

type Query = Record<string, string | number | boolean | undefined | (string | number)[]>;

type Req = {
	method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
	query?: Query;
	body?: unknown;
	/** Skip the auth header — only /api/v1/info/ needs this. */
	anonymous?: boolean;
	timeoutMs?: number;
};

function buildQuery(query: Query | undefined): string {
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

export async function floppy<T = unknown>(path: string, opts: Req = {}): Promise<T> {
	const { method = 'GET', query, body, anonymous = false, timeoutMs = 30_000 } = opts;
	const url = `${baseUrl()}${path}${buildQuery(query)}`;

	const headers: Record<string, string> = { Accept: 'application/json' };
	if (!anonymous) headers['X-API-Key'] = token();
	if (body !== undefined) headers['Content-Type'] = 'application/json';

	let res: Response;
	try {
		res = await fetch(url, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (cause) {
		// The most common failure by far: this machine cannot reach Floppy. Say so
		// plainly — the server has to run somewhere on the same network as Floppy.
		throw new Error(
			`Could not reach Floppy at ${baseUrl()} (${String(cause)}). This server must run ` +
				'on a machine that can reach your Floppy instance, and FLOPPY_URL must be ' +
				'correct for that machine.'
		);
	}

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		if (res.status === 401 || res.status === 403) {
			throw new Error(
				`Floppy rejected the API token (${res.status}). Check FLOPPY_TOKEN against ` +
					'Floppy → Settings → Integrations → API Token.'
			);
		}
		throw new Error(`Floppy ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
	}

	if (res.status === 204) return undefined as T;
	const text = await res.text();
	if (!text) return undefined as T;
	return JSON.parse(text) as T;
}
