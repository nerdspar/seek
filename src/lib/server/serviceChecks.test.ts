import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { openDatabase, useDatabase } from './db';
import { setSettings } from './services';
import { checkGroup, unreachable } from './serviceChecks';

beforeEach(() => useDatabase(openDatabase(':memory:')));
afterEach(() => useDatabase(null));

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('checkGroup', () => {
	it('TMDB is required: no key is a problem, a working key says so', async () => {
		const f = vi.fn().mockResolvedValueOnce(ok({}));
		expect(await checkGroup('tmdb', { fetch: f })).toEqual({ ok: false, message: 'Seek needs a TMDB key to track shows and movies.' });
		expect(f).not.toHaveBeenCalled();
		setSettings({ TMDB_API_KEY: 'k' });
		expect(await checkGroup('tmdb', { fetch: f })).toEqual({ ok: true, message: 'TMDB key works.' });
	});

	it('explains a service that does not answer', async () => {
		setSettings({ SONARR_URL: 'http://sonarr:8989', SONARR_API_KEY: 'k' });
		const down = vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
		const r = await checkGroup('sonarr', { fetch: down, saved: true });
		expect(r?.ok).toBe(false);
		expect(r?.message).toMatch(/^Saved, but .*can't connect \(ECONNREFUSED\)\.$/);
	});

	it('tests what you typed before saving; a secret left alone uses the saved one', async () => {
		setSettings({ SONARR_URL: 'http://old:8989', SONARR_API_KEY: 'saved-key' });
		const f = vi.fn().mockResolvedValueOnce(ok({ version: '4.0' }));
		const r = await checkGroup('sonarr', { fetch: f, values: { SONARR_URL: 'http://new:8989/' } });
		expect(r).toEqual({ ok: true, message: 'Connected to Sonarr 4.0.' });
		expect(f.mock.calls[0][0]).toBe('http://new:8989/api/v3/system/status');
		expect(f.mock.calls[0][1].headers['X-Api-Key']).toBe('saved-key');
	});

	it('treats BookOrbit answering 401 as reachable, and checks the Hardcover token', async () => {
		setSettings({ BOOKORBIT_URL: 'https://bo.test', HARDCOVER_TOKEN: 'hc_pat' });
		const f = vi
			.fn()
			.mockResolvedValueOnce(res(401, {}))
			.mockResolvedValueOnce(ok({ errors: [{ message: 'invalid token' }] }));
		const r = await checkGroup('books', { fetch: f });
		expect(r).toEqual({ ok: false, message: 'BookOrbit is reachable; Hardcover refused the token: HTTP 200.' });
		expect(f.mock.calls[1][1].headers.Authorization).toBe('Bearer hc_pat');
	});

	it('says a half-filled Sonarr needs both fields, and an empty one is just off', async () => {
		setSettings({ SONARR_URL: 'http://sonarr:8989' });
		expect((await checkGroup('sonarr', { fetch: vi.fn() }))?.message).toMatch(/needs both/);
		expect(await checkGroup('radarr', { fetch: vi.fn() })).toEqual({ ok: true, message: 'Radarr is off.' });
	});
});

describe('email check', () => {
	beforeEach(() => setSettings({ RESEND_API_KEY: 're_key', MAIL_FROM: 'Seek <seek@nerdspar.com>' }));

	it('accepts a send-only key (Resend answers 401 restricted_api_key to listing domains)', async () => {
		const f = vi.fn().mockResolvedValueOnce(
			res(401, { statusCode: 401, message: 'This API key is restricted to only send emails', name: 'restricted_api_key' })
		);
		expect(await checkGroup('email', { fetch: f })).toEqual({ ok: true, message: 'Resend key works.' });
	});

	it("rejects a wrong key in Resend's words", async () => {
		const f = vi.fn().mockResolvedValueOnce(res(400, { statusCode: 400, message: 'API key is invalid', name: 'validation_error' }));
		expect(await checkGroup('email', { fetch: f })).toEqual({
			ok: false,
			message: 'Resend refused the key: API key is invalid (HTTP 400).'
		});
	});

	it('the Test button sends a real message, and reports an unverified From domain', async () => {
		const f = vi
			.fn()
			.mockResolvedValueOnce(ok({ id: 'e1' }))
			.mockResolvedValueOnce(res(403, { message: 'The nerdspar.com domain is not verified.' }));
		expect(await checkGroup('email', { fetch: f, sendTo: 'scott@example.com' })).toEqual({
			ok: true,
			message: 'Sent a test email to scott@example.com — check your inbox.'
		});
		const sent = JSON.parse(f.mock.calls[0][1].body);
		expect(sent).toMatchObject({ from: 'Seek <seek@nerdspar.com>', to: ['scott@example.com'] });
		expect((await checkGroup('email', { fetch: f, sendTo: 'scott@example.com' }))?.message).toBe(
			'Resend didn’t send it: The nerdspar.com domain is not verified. (HTTP 403).'
		);
	});

	it('a half-filled email setup says what is missing', async () => {
		expect((await checkGroup('email', { fetch: vi.fn(), values: { MAIL_FROM: '' } }))?.message).toMatch(/From address/);
	});
});

describe('unreachable', () => {
	it('names the real reason Node hides under "fetch failed"', () => {
		const wrap = (cause: unknown) => Object.assign(new TypeError('fetch failed'), { cause });
		expect(unreachable(wrap({ code: 'ENOTFOUND' }))).toBe("can't connect (ENOTFOUND)");
		expect(unreachable(wrap({ errors: [{}, { code: 'ECONNREFUSED' }] }))).toBe("can't connect (ECONNREFUSED)");
		expect(unreachable(wrap({ message: 'unable to verify the first certificate' }))).toBe(
			"can't connect (unable to verify the first certificate)"
		);
		expect(unreachable(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe('no answer (timed out)');
	});
});
