import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase } from '$lib/server/db';
import { animeOverrides } from '$lib/server/anime-sync';
import { PUT } from './+server';

const put = (body: unknown) =>
	PUT({ locals: { user: { id: 1, householdId: 1 } }, request: new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }) } as never);

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x')");
	useDatabase(d);
});
afterEach(() => useDatabase(null));

describe('PUT /api/anime', () => {
	it("records the household's answer", async () => {
		const res = await put({ mediaId: '42', anime: true });
		expect(await res.json()).toEqual({ anime: true });
		expect(animeOverrides(1).get('42')).toBe(true);
	});

	it('refuses a request without a show or an answer', async () => {
		await expect(put({ mediaId: '42' })).rejects.toMatchObject({ status: 400 });
		expect(animeOverrides(1).size).toBe(0);
	});
});
