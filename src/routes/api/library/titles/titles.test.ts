import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase } from '$lib/server/db';
import { runAs } from '$lib/server/userctx';
import type { User } from '$lib/server/users';
import { GET } from './+server';

const me: User = { id: 1, householdId: 1, email: 'a@x', name: 'A', role: 'owner', sessionVersion: 1, emailVerified: true };

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x'), (2, 1, 'b@x', 'B', 'member', 'h', 'x')");
	d.exec(`INSERT INTO titles (media_type, tmdb_id, title, poster, release_date, refresh_after) VALUES
		('tv', 87012, 'The Great British Bake Off', 'p.jpg', '2017-08-29', 'x'), ('movie', 603, 'The Matrix', NULL, '1999-03-30', 'x'), ('tv', 5, 'Hers', NULL, NULL, 'x')`);
	d.exec(`INSERT INTO tracked (user_id, media_type, tmdb_id, status, added_at, updated_at) VALUES
		(1, 'tv', 87012, 1, 'x', 'x'), (1, 'movie', 603, 3, 'x', 'x'), (1, 'tv', 999, 0, 'x', 'x'), (2, 'tv', 5, 1, 'x', 'x')`);
	useDatabase(d);
});
afterEach(() => useDatabase(null));

describe('GET /api/library/titles', () => {
	it('is everything on your list — shows and films, any status — and nothing of anyone else’s', async () => {
		const { titles } = await runAs(me, async () => (await GET({} as never)).json());
		expect(titles).toEqual(
			expect.arrayContaining([
				{ mediaType: 'tv', mediaId: '87012', title: 'The Great British Bake Off', poster: 'p.jpg', status: 1, year: 2017 },
				{ mediaType: 'movie', mediaId: '603', title: 'The Matrix', poster: null, status: 3, year: 1999 }
			])
		);
		// 999 has no info yet (nothing to show), and "Hers" is the other person's.
		expect(titles).toHaveLength(2);
	});
});
