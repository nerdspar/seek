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

import { openDatabase, useDatabase } from '$lib/server/db';
import * as users from '$lib/server/users';
import { POST } from './+server';

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
