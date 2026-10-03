import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* bookorbit.ts keeps a module-level session + list cache, so every test imports
   a fresh copy to stay isolated. */
async function load() {
	vi.resetModules();
	return import('./bookorbit');
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
		delete process.env.BOOKORBIT_PASSWORD;
		expect(bo.bookorbitLinked()).toBe(false);
		delete process.env.BOOKORBIT_URL;
		expect(bo.bookorbitConfigured()).toBe(false);
	});

	it('without a login, says so instead of calling BookOrbit', async () => {
		delete process.env.BOOKORBIT_USER;
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();
		await expect(bo.getReadingGoal()).rejects.toThrow(/No BookOrbit account linked/);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('logs in once, then reuses the cached token with a Bearer header', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json({ goalBooks: 24, completedBooks: 3, year: 2026 }))
			.mockResolvedValueOnce(json({ trackedBooks: 5 }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();

		expect(await bo.getReadingGoal()).toEqual({ goalBooks: 24, completedBooks: 3, year: 2026 });
		await bo.getStatsSummary();

		const urls = fetchMock.mock.calls.map((c) => c[0]);
		expect(urls).toEqual([
			'https://bo.test/api/v1/auth/login',
			'https://bo.test/api/v1/dashboard/widgets/reading-goal',
			'https://bo.test/api/v1/user-statistics/summary'
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
			.mockResolvedValueOnce(json({ goalBooks: 1, completedBooks: 0, year: 2026 }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();

		expect((await bo.getReadingGoal()).goalBooks).toBe(1);
		expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Bearer tok-2');
	});

	it('surfaces a failed login as an error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 401)));
		const bo = await load();
		await expect(bo.getReadingGoal()).rejects.toThrow(/login failed/);
	});

	it('pages through the library (BookOrbit pagination shape) and filters by status in Seek', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json({ items: [book(1, 'reading'), book(2, 'read')], total: 3 }))
			.mockResolvedValueOnce(json({ items: [book(3, 'want_to_read')], total: 3 }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();

		const reading = await bo.getReadingList(['reading', 'want_to_read']);
		expect(reading.map((b) => b.id)).toEqual([1, 3]);
		// 0-based pages under `pagination` — anything else BookOrbit silently ignores.
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ pagination: { page: 0, size: 200 } });
		expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ pagination: { page: 1, size: 200 } });

		// Cached: no further fetches for another view of the same list.
		expect((await bo.getReadingList()).length).toBe(3);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});

describe('setReadStatus', () => {
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

	it('PATCHes your status and refreshes your cached list', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json({ items: [book(1, 'unread')], total: 1 })) // list, cached
			.mockResolvedValueOnce(json({ status: 'want_to_read', source: 'manual' })) // the write
			.mockResolvedValueOnce(json({ items: [book(1, 'want_to_read')], total: 1 })); // refetch
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();

		expect((await bo.getAllBooks())[0].status).toBe('unread');
		expect(await bo.setReadStatus(1, 'want_to_read')).toBe('want_to_read');
		const [url, init] = fetchMock.mock.calls[2];
		expect(url).toBe('https://bo.test/api/v1/books/1/status');
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body)).toEqual({ status: 'want_to_read' });
		// The cache was dropped, so the list reflects the change.
		expect((await bo.getAllBooks())[0].status).toBe('want_to_read');
	});
});

describe('reading snapshot mappers', () => {
	it('maps the streak and challenge widgets', async () => {
		const bo = await load();
		expect(bo.toStreak({ currentStreak: 3, longestStreak: 9, lastSevenDays: [true, false, 1, 0, true, true, false, true] })).toEqual({
			current: 3,
			longest: 9,
			lastSevenDays: [true, false, true, false, true, true, false]
		});
		expect(bo.toChallenge({ title: 'Genre Explorer', description: 'd', progress: 0, target: 0, completed: false })).toMatchObject({
			title: 'Genre Explorer',
			target: 1 // never a divide-by-zero
		});
		expect(bo.toChallenge({})).toBeNull();
	});

	it('totals achievements and picks the three most recently earned', async () => {
		const bo = await load();
		const a = (name: string, awardedAt: string | null) => ({ name, description: '', earned: Boolean(awardedAt), awardedAt });
		const out = bo.toAchievements({
			totalEarned: 4,
			totalAvailable: 87,
			categories: [
				{ achievements: [a('Old', '2026-01-01T00:00:00Z'), a('Not yet', null)] },
				{ achievements: [a('Newest', '2026-09-30T00:00:00Z'), a('Mid', '2026-05-01T00:00:00Z'), a('Older', '2026-03-01T00:00:00Z')] }
			]
		});
		expect(out.earned).toBe(4);
		expect(out.available).toBe(87);
		expect(out.recent.map((x) => x.name)).toEqual(['Newest', 'Mid', 'Older']);
	});
});

describe('getReadingSnapshot', () => {
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

	it('assembles every widget, and one failing widget only blanks itself', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.endsWith('/auth/login')) return json(LOGIN);
				if (url.endsWith('/reading-goal')) return json({ goalBooks: 24, completedBooks: 5, year: 2026 });
				if (url.endsWith('/reading-streak')) return json({ currentStreak: 2, longestStreak: 4, lastSevenDays: [] });
				if (url.endsWith('/summary')) return json({}, 500);
				if (url.endsWith('/monthly-challenge')) return json({ title: 'T', progress: 1, target: 2 });
				if (url.endsWith('/achievements')) return json({ totalEarned: 1, totalAvailable: 87, categories: [] });
				return json({}, 404);
			})
		);
		const bo = await load();
		const snap = await bo.getReadingSnapshot();
		expect(snap.goal?.goalBooks).toBe(24);
		expect(snap.streak?.current).toBe(2);
		expect(snap.summary).toBeNull();
		expect(snap.challenge?.title).toBe('T');
		expect(snap.achievements?.earned).toBe(1);
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

		const mine = await ctx.runAs(owner, () => bo.getReadingList());
		const hers = await ctx.runAs(member, () => bo.getReadingList());
		expect(mine[0].status).toBe('reading');
		expect(hers[0].status).toBe('want_to_read');

		const logins = fetchMock.mock.calls
			.filter((c) => String(c[0]).endsWith('/auth/login'))
			.map((c) => JSON.parse(c[1].body!).username);
		expect(logins).toEqual(['scott', 'wife']);
		db.useDatabase(null);
	});
});
