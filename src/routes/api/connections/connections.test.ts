import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const checkFloppyToken = vi.fn();
const checkBookOrbitLogin = vi.fn();
vi.mock('$lib/server/connections', () => ({
	checkFloppyToken: (...a: unknown[]) => checkFloppyToken(...a),
	checkCalendarToken: vi.fn(),
	checkBookOrbitLogin: (...a: unknown[]) => checkBookOrbitLogin(...a),
	forgetCurrentUserData: vi.fn(),
	normalizeCalendarToken: (t: string) => t
}));
vi.mock('$lib/server/warmup', () => ({ warmInBackground: vi.fn() }));
vi.mock('$lib/server/books/bookorbit', () => ({ bookorbitConfigured: () => true }));
const checkHardcoverToken = vi.fn();
vi.mock('$lib/server/books/hardcover', () => ({ checkHardcoverToken: (...a: unknown[]) => checkHardcoverToken(...a) }));

import { openDatabase, useDatabase } from '$lib/server/db';
import * as users from '$lib/server/users';
import { DELETE, POST, PUT } from './+server';

let me: users.User;
const test = async (service: string) => {
	const res = await POST({
		request: new Request('http://x/api/connections', { method: 'POST', body: JSON.stringify({ service }) }),
		locals: { user: me }
	} as never);
	return res.json();
};

beforeEach(async () => {
	useDatabase(openDatabase(':memory:'));
	me = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
	checkFloppyToken.mockReset();
	checkBookOrbitLogin.mockReset();
	checkHardcoverToken.mockReset();
});
afterEach(() => useDatabase(null));

describe('POST /api/connections (Test)', () => {
	it('checks your saved token against the service, changing nothing', async () => {
		users.setFloppyToken(me.id, 'flp_saved');
		checkFloppyToken.mockResolvedValue({ ok: false, error: 'Floppy rejected that token.' });
		expect(await test('floppy')).toEqual({ ok: false, error: 'Floppy rejected that token.' });
		expect(checkFloppyToken).toHaveBeenCalledWith('flp_saved');
		expect(users.getCredentials(me.id).floppyToken).toBe('flp_saved');
	});

	it('tests the saved BookOrbit login, without leaking the library list', async () => {
		users.setBookOrbit(me.id, { username: 'scott', password: 'pw', libraryId: 1 });
		checkBookOrbitLogin.mockResolvedValue({ ok: true, libraries: [{ id: 1, name: 'Scott' }] });
		expect(await test('bookorbit')).toEqual({ ok: true });
		expect(checkBookOrbitLogin).toHaveBeenCalledWith('scott', 'pw');
	});

	it('says when there is nothing linked to test', async () => {
		expect(await test('calendar')).toEqual({ ok: false, error: 'Not linked.' });
	});
});

describe('your own Hardcover token', () => {
	const call = async (handler: typeof PUT, body: unknown) =>
		handler({ request: new Request('http://x/api/connections', { method: 'PUT', body: JSON.stringify(body) }), locals: { user: me } } as never);

	it('is checked, then stored encrypted; unlinking forgets it', async () => {
		checkHardcoverToken.mockResolvedValue({ ok: true, username: 'nerdspar' });
		const res = await call(PUT, { service: 'hardcover', token: 'hc_mine' });
		expect(await res.json()).toMatchObject({ linked: { hardcover: true }, username: 'nerdspar' });
		expect(users.getCredentials(me.id).hardcoverToken).toBe('hc_mine');

		await call(DELETE, { service: 'hardcover' });
		expect(users.getCredentials(me.id).hardcoverToken).toBeNull();
		expect(users.linkedStatus(me.id).hardcover).toBe(false);
	});

	it('refuses a token Hardcover does not accept, storing nothing', async () => {
		checkHardcoverToken.mockResolvedValue({ ok: false, error: 'Hardcover refused that token.' });
		const res = await call(PUT, { service: 'hardcover', token: 'nope' });
		expect(res.status).toBe(400);
		expect(users.getCredentials(me.id).hardcoverToken).toBeNull();
	});
});
