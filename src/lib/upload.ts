/**
 * Uploading a book from the phone into BookOrbit, through Seek's relay
 * (/api/books/uploads). Resumable: a session remembers how many bytes it has,
 * so a chunk that fails is retried from where BookOrbit says it got to rather
 * than from the start — phones drop connections.
 */

export type UploadTarget = { kind: 'library'; libraryId: number } | { kind: 'book_dock' };

export type UploadSession = {
	id: string;
	filename: string;
	size: number;
	received: number;
	status: 'receiving' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'expired';
	error: string | null;
	bookId: number | null;
};

export type UploadPhase = 'sending' | 'importing' | 'done' | 'failed';
export type UploadProgress = { phase: UploadPhase; sent: number; size: number; error?: string; bookId?: number | null };

type Fetch = typeof fetch;
type Opts = {
	chunkBytes: number;
	onProgress: (p: UploadProgress) => void;
	fetch?: Fetch;
	/** How long to wait for BookOrbit to finish importing before calling it done. */
	pollMs?: number;
	maxPolls?: number;
	/** Retries per chunk before giving up. */
	retries?: number;
	signal?: AbortSignal;
};

/** The extension BookOrbit judges a file by. */
export const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();

/** Why a file can't be uploaded before we try, or null when it's fine. */
export function precheck(file: { name: string; size: number }, formats: string[], maxBytes: number): string | null {
	const ext = extOf(file.name);
	if (formats.length && !formats.includes(ext)) return `${ext ? `.${ext}` : 'This'} isn't a format BookOrbit takes.`;
	if (!file.size) return 'The file is empty.';
	if (maxBytes && file.size > maxBytes) return `Too big — the limit is ${Math.round(maxBytes / 1024 / 1024)} MB.`;
	return null;
}

async function reason(res: Response): Promise<string> {
	const body = (await res.json().catch(() => null)) as { message?: string } | null;
	return body?.message ?? `HTTP ${res.status}`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadFile(file: File, target: UploadTarget, opts: Opts): Promise<UploadProgress> {
	const f = opts.fetch ?? fetch;
	const retries = opts.retries ?? 3;
	const report = (p: UploadProgress) => {
		opts.onProgress(p);
		return p;
	};
	const fail = (error: string, sent = 0) => report({ phase: 'failed', sent, size: file.size, error });

	const key = `seek-${crypto.randomUUID()}`;
	const start = await f('/api/books/uploads', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ filename: file.name, size: file.size, idempotencyKey: key, target }),
		signal: opts.signal
	});
	if (!start.ok) return fail(await reason(start));
	let session = (await start.json()) as UploadSession;
	report({ phase: 'sending', sent: session.received, size: file.size });

	const base = `/api/books/uploads/${session.id}`;
	while (session.received < file.size) {
		const offset = session.received;
		const chunk = file.slice(offset, Math.min(offset + opts.chunkBytes, file.size));
		let res: Response | null = null;
		let lastError = '';
		for (let attempt = 0; attempt <= retries; attempt++) {
			try {
				res = await f(`${base}/chunks`, {
					method: 'POST',
					headers: { 'upload-offset': String(offset), 'x-filename': encodeURIComponent(file.name) },
					body: chunk,
					signal: opts.signal
				});
				if (res.ok) break;
				lastError = await reason(res);
				// A refusal (bad format, wrong offset…) won't fix itself by repeating.
				if (res.status < 500 && res.status !== 408 && res.status !== 429) break;
			} catch (e) {
				if (opts.signal?.aborted) throw e;
				lastError = (e as Error).message;
				res = null;
			}
			// Network trouble: ask BookOrbit how far it actually got before retrying.
			const probe = await f(base, { signal: opts.signal }).catch(() => null);
			if (probe?.ok) {
				const at = (await probe.json()) as UploadSession;
				if (at.received !== offset) {
					res = null;
					session = at;
					break;
				}
			}
			await wait(500 * 2 ** attempt);
		}
		if (res?.ok) session = (await res.json()) as UploadSession;
		else if (session.received === offset) return fail(lastError || 'Upload failed.', offset);
		report({ phase: 'sending', sent: session.received, size: file.size });
	}

	const done = await f(`${base}/complete`, { method: 'POST', signal: opts.signal });
	if (!done.ok) return fail(await reason(done), file.size);
	session = (await done.json()) as UploadSession;

	/* Filing and importing carry on in BookOrbit; watch for a while so the
	   person sees "added" (or why not), but don't hold the sheet hostage. */
	for (let i = 0; session.status === 'processing' && i < (opts.maxPolls ?? 30); i++) {
		report({ phase: 'importing', sent: file.size, size: file.size });
		await wait(opts.pollMs ?? 2000);
		const r = await f(base, { signal: opts.signal }).catch(() => null);
		if (r?.ok) session = (await r.json()) as UploadSession;
	}
	if (session.status === 'failed' || session.status === 'cancelled' || session.status === 'expired') {
		return fail(session.error ?? `Upload ${session.status}.`, file.size);
	}
	return report({ phase: 'done', sent: file.size, size: file.size, bookId: session.bookId });
}
