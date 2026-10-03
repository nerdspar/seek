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

	it('is configured only with url, user and password', async () => {
		const bo = await load();
		expect(bo.bookorbitConfigured()).toBe(true);
		delete process.env.BOOKORBIT_PASSWORD;
		expect(bo.bookorbitConfigured()).toBe(false);
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

	it('pages through the library and filters by status in Seek', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(json(LOGIN))
			.mockResolvedValueOnce(json({ items: [book(1, 'reading'), book(2, 'read')], total: 3 }))
			.mockResolvedValueOnce(json({ items: [book(3, 'want_to_read')] }));
		vi.stubGlobal('fetch', fetchMock);
		const bo = await load();

		const reading = await bo.getReadingList(['reading', 'want_to_read']);
		expect(reading.map((b) => b.id)).toEqual([1, 3]);
		// Second page requested with page: 2.
		expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ limit: 500, page: 2 });

		// Cached: no further fetches for another view of the same list.
		expect((await bo.getReadingList()).length).toBe(3);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});
});
