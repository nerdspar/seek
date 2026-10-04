import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* bookorbit.ts keeps a module-level session + list cache, so every test imports
   a fresh copy to stay isolated. BookOrbit is only ever called *as someone*, so
   every call runs as a signed-in owner whose linked login is the test's
   BOOKORBIT_USER / BOOKORBIT_PASSWORD (no login when those are unset). */
async function load() {
	vi.resetModules();
	const db = await import('../db');
	db.useDatabase(db.openDatabase(':memory:'));
	const users = await import('../users');
	const ctx = await import('../userctx');
	const mod = await import('./bookorbit');
	const owner = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
	const { BOOKORBIT_USER: username, BOOKORBIT_PASSWORD: password } = process.env;
	if (username && password) users.setBookOrbit(owner.id, { username, password, libraryId: null });
	// Functions run as the owner; classes (BookOrbitError) pass through untouched.
	return new Proxy(mod, {
		get(target, key) {
			const v = Reflect.get(target, key);
			return typeof v === 'function' && typeof key === 'string' && /^[a-z]/.test(key)
				? (...args: unknown[]) => ctx.runAs(owner, () => (v as (...a: unknown[]) => unknown)(...args))
				: v;
		}
	});
}

const json = (body: unknown, status = 200) =>
	({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const LOGIN = { accessToken: 'tok-1', accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() };
const book = (id: number, status: string) => ({
	id,
	title: `Book ${id}`,
	authors: ['A'],
	readStatus: { status, source: 'manual' },
	readingProgress: null,
	hasCover: false
});

describe('bookorbit client', () => {
	beforeEach(() => {
		process.env.BOOKORBIT_URL = 'https://bo.test/';
		process.env.BOOKORBIT_USER = 'svc';
		process.env.BOOKORBIT_PASSWORD = 'pw';
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.BOOKORBIT_URL;
		delete process.env.BOOKORBIT_USER;
		delete process.env.BOOKORBIT_PASSWORD;
	});

	it('is configured by the URL; linked only with a login', async () => {
		const bo = await load();
		expect(bo.bookorbitConfigured()).toBe(true);
		expect(bo.bookorbitLinked()).toBe(true);
		(await import('../users')).setBookOrbit(1, null);
		expect(bo.bookorbitLinked()).toBe(false);
		delete process.env.BOOKORBIT_URL;
		expect(bo.bookorbitConfigured()).toBe(false);
	});

	it('without a login, says so instead of calling BookOrbit', async () => {
		delete process.env.BOOKORBIT_USER;
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		await expect(bo.listLibraries()).rejects.toThrow(/No BookOrbit account linked/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('logs in once, then reuses the cached token with a Bearer header', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json([{ id: 1, name: 'Books' }]))
			.mockResolvedValueOnce(json([{ id: 1, name: 'Books' }]));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();

		expect(await bo.listLibraries()).toEqual([{ id: 1, name: 'Books' }]);
		await bo.listLibraries();

		const urls = fetchMock.mock.calls.map((c) => c[0]);
		expect(urls).toEqual([
			'https://bo.test/api/v1/auth/login',
			'https://bo.test/api/v1/libraries',
			'https://bo.test/api/v1/libraries'
		]);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ username: 'svc', password: 'pw' });
		expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok-1');
	});

	it('re-logs in and retries once when the token is rejected', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json({}, 401))
			.mockResolvedValueOnce(json({ ...LOGIN, accessToken: 'tok-2' }))
			.mockResolvedValueOnce(json([{ id: 2, name: 'Audio' }]));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();

		expect((await bo.listLibraries())[0].id).toBe(2);
		expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Bearer tok-2');
	});

	it('surfaces a failed login as an error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 401)));
		const bo = await load();
		await expect(bo.listLibraries()).rejects.toThrow(/login failed/);
	});

	it('pages through the library (BookOrbit pagination shape), and caches it', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json({ items: [book(1, 'reading'), book(2, 'read')], total: 3 }))
			.mockResolvedValueOnce(json({ items: [book(3, 'want_to_read')], total: 3 }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();

		expect((await bo.getAllBooks()).map((b) => b.id)).toEqual([1, 2, 3]);
		// 0-based pages under `pagination` — anything else BookOrbit silently ignores.
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ pagination: { page: 0, size: 200 } });
		expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ pagination: { page: 1, size: 200 } });

		// Cached: no further fetches for another view of the same list.
		expect((await bo.getAllBooks()).length).toBe(3);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});

describe('bookorbit paging guard', () => {
	beforeEach(() => {
		process.env.BOOKORBIT_URL = 'https://bo.test';
		process.env.BOOKORBIT_USER = 'svc';
		process.env.BOOKORBIT_PASSWORD = 'pw';
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.BOOKORBIT_URL;
		delete process.env.BOOKORBIT_USER;
		delete process.env.BOOKORBIT_PASSWORD;
	});

	it('never returns the same book twice when pages overlap', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(json(LOGIN))
				.mockResolvedValueOnce(json({ items: [book(1, 'read'), book(2, 'read')], total: 3 }))
				.mockResolvedValueOnce(json({ items: [book(2, 'read'), book(3, 'read')], total: 3 }))
		);
		const bo = await load();
		expect((await bo.getAllBooks()).map((b) => b.id)).toEqual([1, 2, 3]);
	});
});

describe('bookorbit per person', () => {
	beforeEach(() => {
		process.env.BOOKORBIT_URL = 'https://bo.test';
		process.env.SEEK_TOKEN_KEY = 'k';
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.BOOKORBIT_URL;
		delete process.env.SEEK_TOKEN_KEY;
	});

	it('logs each person in as themselves and keeps their lists apart', async () => {
		vi.resetModules();
		const db = await import('../db');
		db.useDatabase(db.openDatabase(':memory:'));
		const users = await import('../users');
		const ctx = await import('../userctx');
		const bo = await import('./bookorbit');

		const owner = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
		const { token } = users.createInvite(owner, 'm@x.co');
		const member = await users.acceptInvite(token, { name: 'M', password: 'password-2' });
		users.setBookOrbit(owner.id, { username: 'scott', password: 'pw-s', libraryId: 1 });
		users.setBookOrbit(member.id, { username: 'wife', password: 'pw-w', libraryId: 1 });

		// Same library, different per-person statuses.
		const fetchMock = vi.fn(async (url: string, init: { body?: string; headers: Record<string, string> }) => {
			if (url.endsWith('/auth/login')) {
				const who = JSON.parse(init.body!).username;
				return json({ ...LOGIN, accessToken: `tok-${who}` });
			}
			const status = init.headers.Authorization === 'Bearer tok-scott' ? 'reading' : 'want_to_read';
			return json({ items: [book(1, status)], total: 1 });
		});
		vi.stubGlobal('fetch', fetchMock);

		const mine = await ctx.runAs(owner, () => bo.getAllBooks());
		const hers = await ctx.runAs(member, () => bo.getAllBooks());
		expect(mine[0].status).toBe('reading');
		expect(hers[0].status).toBe('want_to_read');

		const logins = fetchMock.mock.calls
			.filter((c) => String(c[0]).endsWith('/auth/login'))
			.map((c) => JSON.parse(c[1].body!).username);
		expect(logins).toEqual(['scott', 'wife']);
		db.useDatabase(null);
	});
});

describe('book requests', () => {
	beforeEach(() => {
		process.env.BOOKORBIT_URL = 'https://bo.test';
		process.env.BOOKORBIT_USER = 'svc';
		process.env.BOOKORBIT_PASSWORD = 'pw';
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.BOOKORBIT_URL;
		delete process.env.BOOKORBIT_USER;
		delete process.env.BOOKORBIT_PASSWORD;
	});

	const card = { hardcoverId: 427578, title: 'Project Hail Mary', author: 'Andy Weir', coverUrl: null, year: 2021 };
	const item = (over: Record<string, unknown> = {}) => ({
		id: 9,
		status: 'pending',
		title: 'Project Hail Mary',
		authors: ['Andy Weir'],
		providerKey: 'hardcover',
		providerId: '427578',
		mediaKind: 'ebook',
		createdAt: '2026-10-03T00:00:00Z',
		...over
	});

	it('files the request as you, into the only library when you have not picked one', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json([{ id: 3, name: 'Books' }]))
			.mockResolvedValueOnce(json({ request: item(), subscribed: false }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();

		const out = await bo.requestBook(card, 'ebook');
		expect(out).toMatchObject({ joined: false, request: { id: 9, status: 'pending', hardcoverId: 427578 } });
		const [url, init] = fetchMock.mock.calls[2];
		expect(url).toBe('https://bo.test/api/v1/book-requests');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({
			title: 'Project Hail Mary',
			mediaKind: 'ebook',
			authors: ['Andy Weir'],
			publishedYear: 2021,
			providerKey: 'hardcover',
			providerId: '427578',
			targetLibraryId: 3
		});
	});

	it('leaves the destination to BookOrbit when there are several libraries', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json([{ id: 3, name: 'Books' }, { id: 4, name: 'Audio' }]))
			.mockResolvedValueOnce(json({ request: item(), subscribed: true }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		expect((await bo.requestBook(card, 'audiobook')).joined).toBe(true);
		const body = JSON.parse(fetchMock.mock.calls[2][1].body);
		expect(body.targetLibraryId).toBeUndefined();
		expect(body.mediaKind).toBe('audiobook');
	});

	it("surfaces BookOrbit's own reason when it refuses", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json([]))
			.mockResolvedValueOnce(
				json({ statusCode: 400, message: 'Pick a destination library', code: 'SUBMIT_DESTINATION_REQUIRED' }, 400)
			);
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		await expect(bo.requestBook(card, 'ebook')).rejects.toMatchObject({
			status: 400,
			message: 'Pick a destination library',
			code: 'SUBMIT_DESTINATION_REQUIRED'
		});
	});

	it('lists and cancels your requests', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json({ items: [item(), item({ id: 10, status: 'downloading', download: { progressPercent: 40 } })], total: 2 }))
			.mockResolvedValueOnce(json(item({ status: 'cancelled' })));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		const list = await bo.listMyRequests();
		expect(list.map((r) => [r.id, r.status, r.progress])).toEqual([
			[9, 'pending', null],
			[10, 'downloading', 0.4]
		]);
		expect((await bo.cancelRequest(9)).status).toBe('cancelled');
		expect(fetchMock.mock.calls[2][0]).toBe('https://bo.test/api/v1/book-requests/9/cancel');
	});
});

describe('uploads', () => {
	beforeEach(() => {
		process.env.BOOKORBIT_URL = 'https://bo.test';
		process.env.BOOKORBIT_USER = 'svc';
		process.env.BOOKORBIT_PASSWORD = 'pw';
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.BOOKORBIT_URL;
		delete process.env.BOOKORBIT_USER;
		delete process.env.BOOKORBIT_PASSWORD;
	});

	const session = (over: Record<string, unknown> = {}) => ({
		id: '6f1c6a3e-0000-4000-8000-000000000001',
		filename: 'dune.epub',
		sizeBytes: 10,
		receivedBytes: 0,
		status: 'receiving',
		...over
	});

	it('offers your libraries, defaulting to the only one', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(json(LOGIN))
				.mockResolvedValueOnce(
					json({
						maxFileSizeBytes: 500,
						chunkSizeBytes: 16,
						supportedFormats: ['epub', 'pdf'],
						canUploadToLibrary: true,
						canUseBookDock: false,
						libraries: [{ id: 3, name: 'Books', allowedFormats: ['epub'] }]
					})
				)
		);
		const bo = await load();
		expect(await bo.uploadOptions()).toEqual({
			maxBytes: 500,
			formats: ['epub', 'pdf'],
			libraries: [{ id: 3, name: 'Books', formats: ['epub'] }],
			dock: false,
			defaultLibraryId: 3
		});
	});

	it('offers no libraries without upload permission', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(json(LOGIN))
				.mockResolvedValueOnce(json({ canUploadToLibrary: false, canUseBookDock: true, libraries: [{ id: 3, name: 'B' }] }))
		);
		const bo = await load();
		const o = await bo.uploadOptions();
		expect(o.libraries).toEqual([]);
		expect(o.dock).toBe(true);
		expect(o.defaultLibraryId).toBeNull();
	});

	it('starts a session, sends a checksummed chunk at its offset, completes', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json(session()))
			.mockResolvedValueOnce(json(session({ receivedBytes: 10 })))
			.mockResolvedValueOnce(json(session({ receivedBytes: 10, status: 'processing' })));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();

		const s = await bo.startUpload({ filename: 'dune.epub', size: 10, idempotencyKey: 'key-12345', target: { kind: 'library', libraryId: 3 } });
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
			filename: 'dune.epub',
			sizeBytes: 10,
			idempotencyKey: 'key-12345',
			target: { kind: 'library', libraryId: 3 }
		});

		const bytes = new TextEncoder().encode('0123456789');
		expect((await bo.sendChunk(s.id, 0, bytes, 'dune.epub')).received).toBe(10);
		const [url, init] = fetchMock.mock.calls[2];
		expect(url).toBe(`https://bo.test/api/v1/uploads/${s.id}/chunks`);
		expect(init.body).toBeInstanceOf(FormData);
		expect(init.headers['Content-Type']).toBeUndefined(); // fetch sets the boundary
		expect(init.headers['upload-offset']).toBe('0');
		expect(init.headers['upload-checksum']).toBe('84d89877f0d4041efb6bf91a16f0248f2fd573e6af05c19f96bedb9f882f7882');

		expect((await bo.finishUpload(s.id)).status).toBe('processing');
		expect(fetchMock.mock.calls[3][0]).toBe(`https://bo.test/api/v1/uploads/${s.id}/complete`);
	});

	it('reports why an upload was refused', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(json(LOGIN))
				.mockResolvedValueOnce(json({ message: 'This library does not accept pdf files', code: 'UPLOAD_FORMAT_NOT_ALLOWED' }, 400))
		);
		const bo = await load();
		await expect(
			bo.startUpload({ filename: 'x.pdf', size: 1, idempotencyKey: 'key-12345', target: { kind: 'library', libraryId: 3 } })
		).rejects.toMatchObject({ status: 400, code: 'UPLOAD_FORMAT_NOT_ALLOWED', message: 'This library does not accept pdf files' });
	});
});

describe('shelves', () => {
	beforeEach(() => {
		process.env.BOOKORBIT_URL = 'https://bo.test';
		process.env.BOOKORBIT_USER = 'svc';
		process.env.BOOKORBIT_PASSWORD = 'pw';
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.BOOKORBIT_URL;
		delete process.env.BOOKORBIT_USER;
		delete process.env.BOOKORBIT_PASSWORD;
	});

	const coll = (id: number, over: Record<string, unknown> = {}) => ({
		id,
		name: `S${id}`,
		mediaType: 'books',
		isOwner: true,
		bookCount: id,
		displayOrder: id,
		...over
	});

	it('lists only your own book shelves, in your order', async () => {
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce(json(LOGIN))
				.mockResolvedValueOnce(
					json([coll(2, { displayOrder: 5 }), coll(1), coll(3, { isOwner: false }), coll(4, { mediaType: 'podcasts' })])
				)
		);
		const bo = await load();
		expect(await bo.listShelves()).toEqual([
			{ id: 1, name: 'S1', count: 1 },
			{ id: 2, name: 'S2', count: 2 }
		]);
	});

	it("marks which shelves a book is on, and shelves/unshelves it", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json([coll(1, { memberCount: 1 }), coll(2, { memberCount: 0 })]))
			.mockResolvedValueOnce(json({ added: 1 }))
			.mockResolvedValueOnce(json({ removed: 1 }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		expect((await bo.shelvesFor(41)).map((s) => [s.id, s.has])).toEqual([
			[1, true],
			[2, false]
		]);
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ bookIds: [41] });
		await bo.shelveBook(2, 41, true);
		await bo.shelveBook(1, 41, false);
		expect(fetchMock.mock.calls.slice(2).map((c) => [c[0], c[1].method, c[1].body])).toEqual([
			['https://bo.test/api/v1/collections/2/books', 'POST', '{"bookIds":[41]}'],
			['https://bo.test/api/v1/collections/1/books', 'DELETE', '{"bookIds":[41]}']
		]);
	});

	it('creates with an icon BookOrbit requires, and deletes (empty reply)', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json(coll(9, { name: 'Beach reads', bookCount: 0 })))
			.mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new Error('no body'); } } as unknown as Response);
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		expect(await bo.createShelf('Beach reads')).toEqual({ id: 9, name: 'Beach reads', count: 0 });
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ name: 'Beach reads', icon: 'BookMarked' });
		await expect(bo.deleteShelf(9)).resolves.toBeUndefined();
	});

	it("pages through a shelf's books", async () => {
		const page = (ids: number[], total: number) =>
			json({ items: ids.map((id) => ({ id, title: `B${id}`, readStatus: { status: 'read' } })), total });
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(page([1, 2], 3))
			.mockResolvedValueOnce(page([3], 3));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		expect((await bo.shelfBooks(5)).map((b) => [b.id, b.status])).toEqual([
			[1, 'read'],
			[2, 'read'],
			[3, 'read']
		]);
		expect(fetchMock.mock.calls[2][0]).toBe('https://bo.test/api/v1/collections/5/books?page=1&size=100');
	});
});

describe('send to device', () => {
	beforeEach(() => {
		process.env.BOOKORBIT_URL = 'https://bo.test';
		process.env.BOOKORBIT_USER = 'svc';
		process.env.BOOKORBIT_PASSWORD = 'pw';
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.BOOKORBIT_URL;
		delete process.env.BOOKORBIT_USER;
		delete process.env.BOOKORBIT_PASSWORD;
	});

	it('lists devices (default first), reports the last send, and sends to one', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(
				json([
					{ id: 1, name: 'Kobo', email: 'k@x', deviceType: 'kobo', isDefault: false },
					{ id: 2, name: 'Kindle', email: 'me@kindle.com', deviceType: 'kindle', isDefault: true }
				])
			)
			.mockResolvedValueOnce(json([{ status: 'failed', toName: 'Kindle', errorMessage: 'Too large', createdAt: '2026-10-01' }]))
			.mockResolvedValueOnce(json({ queued: 1 }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		expect((await bo.listDevices()).map((d) => [d.id, d.kind])).toEqual([
			[2, 'kindle'],
			[1, 'kobo']
		]);
		expect(await bo.lastSend(41)).toEqual({ status: 'failed', to: 'Kindle', error: 'Too large', at: '2026-10-01' });
		expect(fetchMock.mock.calls[2][0]).toBe('https://bo.test/api/v1/email/log?bookId=41&size=1');
		await bo.sendToDevice(41, 2);
		expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ bookIds: [41], recipientIds: [2] });
	});
});

describe('downloading it yourself', () => {
	beforeEach(() => {
		process.env.BOOKORBIT_URL = 'https://bo.test';
		process.env.BOOKORBIT_USER = 'svc';
		process.env.BOOKORBIT_PASSWORD = 'pw';
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.BOOKORBIT_URL;
		delete process.env.BOOKORBIT_USER;
		delete process.env.BOOKORBIT_PASSWORD;
	});
	const card = { hardcoverId: 7, title: 'Dune', author: 'Frank Herbert', coverUrl: null, year: 1965 };
	const req = (over: Record<string, unknown> = {}) => ({ id: 3, status: 'approved', title: 'Dune', providerKey: 'hardcover', providerId: '7', ...over });

	it('files a self-serve request when you may fetch books yourself', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json({ permissions: ['book_request_access', 'book_request_self_fulfill'] }))
			.mockResolvedValueOnce(json([{ id: 3, name: 'Books' }]))
			.mockResolvedValueOnce(json({ request: req(), subscribed: false }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		const out = await bo.startDownload(card, 'ebook');
		expect(out).toMatchObject({ selfServe: true, joined: false, request: { id: 3 } });
		expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toMatchObject({ selfServe: true, targetLibraryId: 3, mediaKind: 'ebook' });
	});

	it('falls back to an ordinary request without the permission', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json({ permissions: ['book_request_access'] }))
			.mockResolvedValueOnce(json([]))
			.mockResolvedValueOnce(json({ request: req({ status: 'pending' }) }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		expect((await bo.startDownload(card, 'audiobook')).selfServe).toBe(false);
		expect(JSON.parse(fetchMock.mock.calls[3][1].body).selfServe).toBeUndefined();
	});

	it('searches releases, then grabs one by indexer and guid (never a URL)', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(
				json({ releases: [{ indexerId: 2, guid: 'abc', title: 'Dune epub', score: 9 }], indexers: [{ ok: true }], enabledIndexerCount: 1 })
			)
			.mockResolvedValueOnce(json({ ok: true }))
			.mockResolvedValueOnce(json(req({ status: 'grabbed' })));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		const s = await bo.searchReleases(3);
		expect(s.releases.map((r) => r.guid)).toEqual(['abc']);
		expect(fetchMock.mock.calls[1][0]).toBe('https://bo.test/api/v1/book-request-fulfilment/3/releases/search');
		expect((await bo.grabRelease(3, { indexerId: 2, guid: 'abc' })).status).toBe('grabbed');
		expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ indexerId: 2, releaseGuid: 'abc' });
	});
});

describe('abandoning and reviewing downloads', () => {
	beforeEach(() => {
		process.env.BOOKORBIT_URL = 'https://bo.test';
		process.env.BOOKORBIT_USER = 'svc';
		process.env.BOOKORBIT_PASSWORD = 'pw';
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.BOOKORBIT_URL;
		delete process.env.BOOKORBIT_USER;
		delete process.env.BOOKORBIT_PASSWORD;
	});

	it('cancels and hides a request you walked away from', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json({ id: 3, status: 'approved' }))
			.mockResolvedValueOnce(json({ id: 3, status: 'cancelled' }))
			.mockResolvedValueOnce(json({ id: 3, status: 'cancelled' }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		await bo.abandonRequest(3);
		expect(fetchMock.mock.calls.slice(2).map((c) => c[0])).toEqual([
			'https://bo.test/api/v1/book-requests/3/cancel',
			'https://bo.test/api/v1/book-requests/3/dismiss'
		]);
	});

	it('leaves a request alone once something is downloading', async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(json(LOGIN)).mockResolvedValueOnce(json({ id: 3, status: 'downloading' }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		await bo.abandonRequest(3);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('files or discards a held import', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json({ id: 3, status: 'available', matchedBookId: 50 }))
			.mockResolvedValueOnce(json({ id: 4, status: 'failed' }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		expect((await bo.fileHeldImport(3)).status).toBe('available');
		expect((await bo.discardHeldImport(4)).status).toBe('failed');
		expect(fetchMock.mock.calls.slice(1).map((c) => c[0])).toEqual([
			'https://bo.test/api/v1/book-request-fulfilment/3/force-file',
			'https://bo.test/api/v1/book-request-fulfilment/4/discard-import'
		]);
	});
});
