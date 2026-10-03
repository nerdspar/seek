import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, useDatabase } from './db';
import { setSettings } from './services';
import { checkGroup } from './serviceChecks';

beforeEach(() => useDatabase(openDatabase(':memory:')));
afterEach(() => useDatabase(null));

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });

describe('checkGroup', () => {
	it('confirms Floppy by its version, and explains an unreachable one', async () => {
		setSettings({ FLOPPY_URL: 'http://floppy:8007' });
		const f = vi.fn().mockResolvedValueOnce(ok({ version: 'v26.9.24' }));
		expect(await checkGroup('floppy', f)).toEqual({ ok: true, message: 'Connected to Floppy v26.9.24.' });
		expect(f.mock.calls[0][0]).toBe('http://floppy:8007/api/v1/info/');

		const down = vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
		expect(await checkGroup('floppy', down)).toEqual({
			ok: false,
			message: "Saved, but Floppy didn’t answer: can't connect (ECONNREFUSED)."
		});
	});

	it('treats BookOrbit answering 401 as reachable, and checks the Hardcover token', async () => {
		setSettings({ BOOKORBIT_URL: 'https://bo.test', HARDCOVER_TOKEN: 'hc_pat' });
		const f = vi
			.fn()
			.mockResolvedValueOnce(new Response('{}', { status: 401 }))
			.mockResolvedValueOnce(ok({ errors: [{ message: 'invalid token' }] }));
		const r = await checkGroup('books', f);
		expect(r).toEqual({ ok: false, message: 'Saved, but BookOrbit is reachable; Hardcover refused the token: HTTP 200.' });
		expect(f.mock.calls[1][1].headers.Authorization).toBe('Bearer hc_pat');
	});

	it('says a half-filled Sonarr needs both fields, and an empty one is just off', async () => {
		setSettings({ SONARR_URL: 'http://sonarr:8989' });
		expect((await checkGroup('sonarr', vi.fn()))?.message).toMatch(/needs both/);
		expect(await checkGroup('radarr', vi.fn())).toEqual({ ok: true, message: 'Radarr is off.' });
	});
});
