import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase, db } from './db';
import { runAs } from './userctx';
import type { User } from './users';
import { animeTagQuery, getItemTags, setJoint, ANIME_TAG, JOINT_TAG } from './tags';
import { setAnimeOverride } from './anime-sync';

const me: User = { id: 1, householdId: 1, email: 'a@x', name: 'A', role: 'owner', sessionVersion: 1, emailVerified: true };

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x'), (2, 1, 'b@x', 'B', 'member', 'h', 'x')");
	d.exec(`INSERT INTO titles (media_type, tmdb_id, title, genres, origin_country, refresh_after) VALUES
		('tv', 65942, 'Re:ZERO', '["Animation"]', '["JP"]', 'x'), ('tv', 1, 'Lanterns', '["Drama"]', '["US"]', 'x')`);
	useDatabase(d);
});
afterEach(() => useDatabase(null));

describe('labels from Seek', () => {
	it('anime by the rule, and the household override wins', async () => {
		expect(await runAs(me, () => getItemTags('tv', 'tmdb', '65942'))).toEqual([ANIME_TAG]);
		expect(await runAs(me, () => getItemTags('tv', 'tmdb', '1'))).toEqual([]);
		setAnimeOverride(1, 1, '65942', false);
		expect(await runAs(me, () => getItemTags('tv', 'tmdb', '65942'))).toEqual([]);
	});

	it('together is the shared list, for the whole household', async () => {
		expect(await runAs(me, () => setJoint('tv', 'tmdb', '1', true, 'Lanterns'))).toEqual([JOINT_TAG]);
		const partner = { ...me, id: 2 };
		expect(await runAs(partner, () => getItemTags('tv', 'tmdb', '1'))).toEqual([JOINT_TAG]);
		expect(await runAs(partner, () => getItemTags('movie', 'tmdb', '1'))).toEqual([]);
		await runAs(me, () => setJoint('tv', 'tmdb', '1', false));
		expect((db().prepare('SELECT COUNT(*) AS n FROM shared_shows').get() as { n: number }).n).toBe(0);
	});
});

describe('animeTagQuery', () => {
	it('only keeps the anime shows', () => {
		expect(animeTagQuery('only')).toEqual({ tag: ANIME_TAG });
	});
	it('hide keeps the rest (inverts the tag)', () => {
		expect(animeTagQuery('hide')).toEqual({ tag: ANIME_TAG, tagMode: 'not' });
	});
	it('all applies no filter', () => {
		expect(animeTagQuery('all')).toEqual({});
	});
});
