import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkBookOrbitLogin } from './connections';

const res = (status: number, body: unknown = {}) =>
	({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => '' }) as Response;

beforeEach(() => {
	process.env.BOOKORBIT_URL = 'https://bo.test';
});
afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.BOOKORBIT_URL;
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
