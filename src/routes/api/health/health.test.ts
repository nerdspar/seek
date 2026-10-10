import { describe, it, expect, afterEach } from 'vitest';
import { openDatabase, useDatabase } from '$lib/server/db';
import { GET } from './+server';

const get = (authed: boolean) => GET({ locals: { authed } } as never);
afterEach(() => useDatabase(null));

describe('GET /api/health', () => {
	it('is healthy when Seek can read its database, and tells only a signed-in caller the build', async () => {
		useDatabase(openDatabase(':memory:'));
		const anon = await get(false);
		expect([anon.status, await anon.json()]).toEqual([200, { ok: true }]);
		expect(await (await get(true)).json()).toMatchObject({ ok: true, build: expect.any(String) });
	});

	it('is unhealthy when it cannot', async () => {
		const d = openDatabase(':memory:');
		useDatabase(d);
		d.close();
		expect((await get(false)).status).toBe(503);
	});
});
