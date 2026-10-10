import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase, db } from '$lib/server/db';
import { feedToken, jellyfinToken, userByFeedToken } from '$lib/server/users';
import { GET } from './+server';

const get = async (token: string) => GET({ params: { token } } as never);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x'), (2, 1, 'b@x', 'B', 'member', 'h', 'x')");
	d.exec("INSERT INTO titles (media_type, tmdb_id, title, refresh_after) VALUES ('tv', 10, 'Lanterns', 'x')");
	const ep = d.prepare("INSERT INTO episodes (tmdb_id, season, episode, title, air_date) VALUES (10, 1, ?, 'x', ?)");
	ep.run(1, day(-10)); // long aired: not on a mirror
	ep.run(2, day(2));
	d.exec("INSERT INTO tracked (user_id, media_type, tmdb_id, status, added_at, updated_at) VALUES (1, 'tv', 10, 1, 'x', 'x')");
	useDatabase(d);
});
afterEach(() => useDatabase(null));

describe('GET /feed/{token}/upcoming.json', () => {
	it("is the token holder's upcoming episodes, from yesterday on, date-only kept on its day", async () => {
		const res = await get(feedToken(1));
		expect(res.status).toBe(200);
		expect((await res.json()).events).toEqual([
			{ title: 'Lanterns', season: 1, episode: 2, start: `${day(2)}T12:00:00.000Z`, hasTime: false, mediaType: 'tv', mediaId: '10' }
		]);
		// Someone else's feed is their own list.
		expect((await (await get(feedToken(2))).json()).events).toEqual([]);
	});

	it('an unknown token, or the webhook token, opens nothing', async () => {
		expect((await get('x'.repeat(43))).status).toBe(404);
		expect((await get(jellyfinToken(1))).status).toBe(404);
	});

	it('one token per person, kept', () => {
		const t = feedToken(1);
		expect(feedToken(1)).toBe(t);
		expect(userByFeedToken(t)?.id).toBe(1);
		expect(db().prepare('SELECT COUNT(DISTINCT feed_token) AS n FROM users WHERE feed_token IS NOT NULL').get()).toEqual({ n: 1 });
	});
});
