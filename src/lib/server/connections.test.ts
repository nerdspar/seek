import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkFloppyToken, checkCalendarToken, checkBookOrbitLogin, normalizeCalendarToken } from './connections';

describe('normalizeCalendarToken', () => {
	it('accepts the bare token or the whole feed link', () => {
		expect(normalizeCalendarToken('  abc123 ')).toBe('abc123');
		expect(normalizeCalendarToken('http://10.0.1.14:8007/calendar/download/abc123?media_types=tv')).toBe('abc123');
		expect(normalizeCalendarToken('https://floppy.example/calendar/download/abc%2D1/')).toBe('abc-1');
	});
});

const res = (status: number, body: unknown = {}) =>
	({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => '' }) as Response;

beforeEach(() => {
	process.env.FLOPPY_URL = 'http://floppy.test';
	process.env.BOOKORBIT_URL = 'https://bo.test';
});
afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.FLOPPY_URL;
	delete process.env.BOOKORBIT_URL;
});

describe('checkFloppyToken', () => {
	it('accepts a token Floppy authenticates, sending it as the API key', async () => {
		const fetchMock = vi.fn().mockResolvedValue(res(200));
		vi.stubGlobal('fetch', fetchMock);
		expect(await checkFloppyToken(' flp_x ')).toEqual({ ok: true });
		expect(fetchMock.mock.calls[0][0]).toBe('http://floppy.test/api/v1/user/preferences/');
		expect(fetchMock.mock.calls[0][1].headers['X-API-Key']).toBe('flp_x');
	});

	it('explains a rejected token', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401)));
		const r = await checkFloppyToken('bad');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/rejected/);
	});

	it('says when Floppy is unreachable, and refuses an empty token without a call', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
		const r = await checkFloppyToken('x');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/Couldn't reach Floppy/);
		expect((await checkFloppyToken('  ')).ok).toBe(false);
	});
});

describe('checkCalendarToken', () => {
	it('accepts a token with a feed, rejects one without', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res(200)).mockResolvedValueOnce(res(404)));
		expect(await checkCalendarToken('cal')).toEqual({ ok: true });
		expect((await checkCalendarToken('nope')).ok).toBe(false);
	});
});

describe('checkBookOrbitLogin', () => {
	it('signs in and returns the libraries this login can see', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(res(200, { accessToken: 'tok' }))
			.mockResolvedValueOnce(res(200, [{ id: 1, name: 'Books' }, { id: 2, name: 'Comics' }]));
		vi.stubGlobal('fetch', fetchMock);
		expect(await checkBookOrbitLogin('scott', 'pw')).toEqual({
			ok: true,
			libraries: [
				{ id: 1, name: 'Books' },
				{ id: 2, name: 'Comics' }
			]
		});
		expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
	});

	it('explains a wrong password', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401)));
		const r = await checkBookOrbitLogin('scott', 'nope');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/rejected/);
	});

	it('needs BookOrbit configured and both fields', async () => {
		expect((await checkBookOrbitLogin('', 'pw')).ok).toBe(false);
		delete process.env.BOOKORBIT_URL;
		const r = await checkBookOrbitLogin('scott', 'pw');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/Settings → Services/);
	});
});
