import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* Module-level caches — load a fresh copy per test. */
async function load() {
	vi.resetModules();
	return import('./hardcover');
}

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) }) as Response;
const book = (id: number, cover = true) => ({
	id,
	title: `Book ${id}`,
	rating: 4,
	release_year: 2026,
	cached_contributors: [{ author: { name: 'Author' }, primary: true }],
	image: cover ? { url: `https://assets.hardcover.app/${id}.jpg` } : null
});

beforeEach(() => {
	process.env.HARDCOVER_TOKEN = 'hc_pat_test';
});
afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.HARDCOVER_TOKEN;
});

describe('discoverRails', () => {
	it('fetches every shelf in one request, in order, dropping cover-less and repeated books', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			ok({
				thisYear: [book(1), book(1), book(2, false)],
				newest: [book(3)],
				soon: [],
				classics: [book(4)]
			})
		);
		vi.stubGlobal('fetch', fetchMock);
		const hc = await load();

		const rails = await hc.discoverRails(new Date('2026-10-03T12:00:00Z'));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(rails.map((r) => r.key)).toEqual(['thisYear', 'newest', 'classics']); // empty shelf dropped
		expect(rails[0].title).toBe('Popular in 2026');
		expect(rails[0].books.map((b) => b.hardcoverId)).toEqual([1]);

		const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(sent.variables).toEqual({ year: 2026, ago: '2026-08-04', today: '2026-10-03', ahead: '2027-04-01' });
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer hc_pat_test');
	});

	it('caches for the day', async () => {
		const fetchMock = vi.fn().mockResolvedValue(ok({ thisYear: [book(1)], newest: [], soon: [], classics: [] }));
		vi.stubGlobal('fetch', fetchMock);
		const hc = await load();
		await hc.discoverRails(new Date('2026-10-03T08:00:00Z'));
		await hc.discoverRails(new Date('2026-10-03T20:00:00Z'));
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('surfaces GraphQL errors, which arrive with HTTP 200', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'depth limit' }] }) })
		);
		const hc = await load();
		await expect(hc.discoverRails()).rejects.toThrow(/depth limit/);
	});

	it('does not double the Bearer prefix and refuses without a token', async () => {
		process.env.HARDCOVER_TOKEN = 'Bearer hc_pat_x';
		const fetchMock = vi.fn().mockResolvedValue(ok({ thisYear: [], newest: [], soon: [], classics: [] }));
		vi.stubGlobal('fetch', fetchMock);
		let hc = await load();
		await hc.discoverRails();
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer hc_pat_x');

		delete process.env.HARDCOVER_TOKEN;
		hc = await load();
		expect(hc.hardcoverConfigured()).toBe(false);
		await expect(hc.discoverRails()).rejects.toThrow(/not configured/);
	});
});

describe('searchBooks', () => {
	const doc = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
		document: { id, title, author_names: ['Frank Herbert'], users_count: 500, ...extra }
	});
	const hits = (...h: unknown[]) => ({ results: { hits: h } });

	it('leads with relevance, fills from popularity, dedupes, keeps real cover-less books', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			ok({
				relevance: hits(doc('5', 'Dune', { image: { url: 'u' } }), doc('6', 'Dune Messiah')),
				popular: hits(doc('5', 'Dune'), doc('7', 'Children of Dune'))
			})
		);
		vi.stubGlobal('fetch', fetchMock);
		const hc = await load();
		const cards = await hc.searchBooks('  dune ');
		expect(cards.map((c) => c.hardcoverId)).toEqual([5, 6, 7]);
		expect(JSON.parse(fetchMock.mock.calls[0][1].body).variables).toEqual({ q: 'dune', n: 20 });
		expect(await hc.searchBooks('')).toEqual([]);
	});

	it('drops placeholder stubs so an author search reaches their real books', async () => {
		const stub = (id: string) => doc(id, 'James Patterson', { users_count: 1, image: {} });
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				ok({
					relevance: hits(stub('1'), stub('2'), stub('3')),
					popular: hits(doc('9', 'Along Came a Spider', { image: { url: 'u' } }))
				})
			)
		);
		const hc = await load();
		expect((await hc.searchBooks('james patterson')).map((c) => c.title)).toEqual(['Along Came a Spider']);
	});
});

describe('isStub', () => {
	it('flags only cover-less, nearly unread entries', async () => {
		const hc = await load();
		expect(hc.isStub({ users_count: 1, image: null })).toBe(true);
		expect(hc.isStub({ users_count: 1, image: { url: 'x' } })).toBe(false);
		expect(hc.isStub({ users_count: 40, image: null })).toBe(false);
	});
});

describe('bookDetail', () => {
	it('maps a book and remembers a missing one as null', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(ok({ books_by_pk: { ...book(9), description: 'About it', cached_tags: {} } }))
			.mockResolvedValueOnce(ok({ books_by_pk: null }));
		vi.stubGlobal('fetch', fetchMock);
		const hc = await load();
		expect((await hc.bookDetail(9))?.description).toBe('About it');
		expect(await hc.bookDetail(404)).toBeNull();
		expect(await hc.bookDetail(404)).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe('your own Hardcover account', () => {
	it('checks a token by asking who it belongs to, using that token', async () => {
		const fetchMock = vi.fn().mockResolvedValue(ok({ me: [{ username: 'nerdspar' }] }));
		vi.stubGlobal('fetch', fetchMock);
		const hc = await load();
		expect(await hc.checkHardcoverToken('mine')).toEqual({ ok: true, username: 'nerdspar' });
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer mine');
	});

	it('explains a refused or empty token', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response));
		const hc = await load();
		expect(await hc.checkHardcoverToken('bad')).toEqual({ ok: false, error: 'Hardcover refused that token.' });
		expect(await hc.checkHardcoverToken('  ')).toMatchObject({ ok: false });
	});

});
