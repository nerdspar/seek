import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase } from '../db';
import * as users from '../users';
import { share } from './shared';
import { reconcileHousehold, backfillShow, playsFromHistory, SAME_VIEWING_MS, type Ops, type Play } from './mirror';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-03T12:00:00Z');

let owner: users.User;
let wife: users.User;

/* A fake Floppy: each person's plays, and every POST recorded. */
function fakeFloppy(initial: Record<number, Play[]>) {
	const plays = new Map<number, Play[]>(Object.entries(initial).map(([k, v]) => [Number(k), [...v]]));
	let nextInstance = 9000;
	const posts: { user: number; play: Play }[] = [];
	let failNext = 0;
	const mine = (u: users.User) => plays.get(u.id) ?? [];
	const ops: Ops = {
		recentPlays: async (u, since) => mine(u).filter((p) => p.at >= since).sort((a, b) => b.at - a.at),
		showPlays: async (u, s, m, kind) => mine(u).filter((p) => p.source === s && p.mediaId === m && p.mediaType === kind),
		postPlay: async (u, p) => {
			if (failNext > 0) {
				failNext--;
				throw new Error('Floppy hiccup');
			}
			posts.push({ user: u.id, play: p });
			plays.set(u.id, [...mine(u), { ...p, instance: nextInstance++ }]);
		}
	};
	return { ops, posts, plays, failOnce: () => (failNext = 1) };
}

const play = (mediaId: string, season: number, episode: number, at: number, instance: number | null): Play => ({
	mediaType: 'tv',
	source: 'tmdb',
	mediaId,
	season,
	episode,
	at,
	instance
});

beforeEach(async () => {
	process.env.SEEK_TOKEN_KEY = 'test-token-key';
	useDatabase(openDatabase(':memory:'));
	owner = await users.createOwner({ email: 'o@x.co', name: 'Scott', password: 'password-1' });
	const { token } = users.createInvite(owner, 'w@x.co');
	wife = await users.acceptInvite(token, { name: 'Wife', password: 'password-2' });
	users.setFloppyToken(owner.id, 'flp_owner');
	users.setFloppyToken(wife.id, 'flp_wife');
	share(owner.householdId, owner.id, { source: 'tmdb', mediaId: '95350', title: 'Lanterns' });
});
afterEach(() => {
	useDatabase(null);
	delete process.env.SEEK_TOKEN_KEY;
});

describe('playsFromHistory', () => {
	it('reads episode and film plays from a flat history page (a film is S0E0)', () => {
		const out = playsFromHistory({
			results: [
				{
					media_type: 'episode',
					item: { media_id: '95350', source: 'tmdb', season_number: 1, episode_number: 5 },
					season_number: 1,
					episode_number: 5,
					played_at_local: '2026-10-02T23:42:58.908987-04:00',
					instance_id: 22629
				},
				{ media_type: 'movie', item: { media_id: '1', source: 'tmdb' }, played_at_local: '2026-10-02T20:00:00Z', instance_id: 7 },
				{ media_type: 'book', item: { media_id: '2', source: 'hardcover' }, played_at_local: '2026-10-02T20:00:00Z' }
			]
		});
		expect(out).toEqual([
			{ mediaType: 'tv', source: 'tmdb', mediaId: '95350', season: 1, episode: 5, at: Date.parse('2026-10-03T03:42:58.908Z'), instance: 22629 },
			{ mediaType: 'movie', source: 'tmdb', mediaId: '1', season: 0, episode: 0, at: Date.parse('2026-10-02T20:00:00Z'), instance: 7 }
		]);
	});
});

describe('reconcileHousehold', () => {
	it("carries a shared show's play to the partner at the same time, and only shared shows", async () => {
		const f = fakeFloppy({ [owner.id]: [play('95350', 1, 5, NOW - HOUR, 1), play('111', 1, 1, NOW - HOUR, 2)] });
		expect(await reconcileHousehold(owner.householdId, f.ops, NOW)).toEqual({ mirrored: 1, already: 0, failed: 0 });
		expect(f.posts).toEqual([{ user: wife.id, play: play('95350', 1, 5, NOW - HOUR, 1) }]);
	});

	it('never posts the same play twice, and never echoes it back', async () => {
		const f = fakeFloppy({ [owner.id]: [play('95350', 1, 5, NOW - HOUR, 1)] });
		await reconcileHousehold(owner.householdId, f.ops, NOW);
		await reconcileHousehold(owner.householdId, f.ops, NOW + 10 * 60_000);
		expect(f.posts).toHaveLength(1);
		expect(f.posts.every((p) => p.user === wife.id)).toBe(true);
	});

	it('leaves it alone when the partner already logged that viewing (watched together)', async () => {
		const f = fakeFloppy({
			[owner.id]: [play('95350', 1, 5, NOW - HOUR, 1)],
			[wife.id]: [play('95350', 1, 5, NOW - 3 * HOUR, 50)]
		});
		expect(await reconcileHousehold(owner.householdId, f.ops, NOW)).toEqual({ mirrored: 0, already: 2, failed: 0 });
		expect(f.posts).toEqual([]);
	});

	it('a rewatch long after the partner saw it still counts for them', async () => {
		const f = fakeFloppy({
			[owner.id]: [play('95350', 1, 5, NOW - HOUR, 1)],
			[wife.id]: [play('95350', 1, 5, NOW - SAME_VIEWING_MS - 30 * 24 * HOUR, 50)]
		});
		await reconcileHousehold(owner.householdId, f.ops, NOW);
		expect(f.posts.map((p) => p.user)).toEqual([wife.id]);
	});

	it('retries a failed post on the next run', async () => {
		const f = fakeFloppy({ [owner.id]: [play('95350', 1, 5, NOW - HOUR, 1)] });
		f.failOnce();
		expect((await reconcileHousehold(owner.householdId, f.ops, NOW)).failed).toBe(1);
		expect((await reconcileHousehold(owner.householdId, f.ops, NOW + 600_000)).mirrored).toBe(1);
		expect(f.posts).toHaveLength(1);
	});

	it("re-reads a little before the last scan (late scrobbles) but not all history", async () => {
		const f = fakeFloppy({ [owner.id]: [] });
		await reconcileHousehold(owner.householdId, f.ops, NOW);
		f.plays.set(owner.id, [play('95350', 1, 6, NOW - 24 * HOUR, 3), play('95350', 1, 1, NOW - 10 * 24 * HOUR, 4)]);
		await reconcileHousehold(owner.householdId, f.ops, NOW + HOUR);
		expect(f.posts.map((p) => p.play.episode)).toEqual([6]);
	});

	it('does nothing until two people have Floppy linked', async () => {
		users.setFloppyToken(wife.id, null);
		const f = fakeFloppy({ [owner.id]: [play('95350', 1, 5, NOW - HOUR, 1)] });
		expect(await reconcileHousehold(owner.householdId, f.ops, NOW)).toEqual({ mirrored: 0, already: 0, failed: 0 });
	});
});

describe('backfillShow', () => {
	it("fills in only episodes the other person hasn't seen, both ways, without carrying back", async () => {
		const f = fakeFloppy({
			[owner.id]: [play('95350', 1, 1, NOW - 9 * HOUR, 1), play('95350', 1, 2, NOW - 8 * HOUR, 2), play('95350', 1, 3, NOW - 7 * HOUR, 3)],
			[wife.id]: [play('95350', 1, 2, NOW - 100 * HOUR, 50), play('95350', 1, 4, NOW - 2 * HOUR, 51)]
		});
		const sum = await backfillShow(owner.householdId, 'tmdb', '95350', f.ops);
		expect(f.posts.map((p) => [p.user === wife.id ? 'wife' : 'owner', p.play.episode])).toEqual([
			['wife', 1],
			['wife', 3],
			['owner', 4]
		]);
		expect(sum).toEqual({ mirrored: 3, already: 2, failed: 0 });
	});
});

describe('films', () => {
	const film = (mediaId: string, at: number, instance: number | null): Play => ({
		mediaType: 'movie',
		source: 'tmdb',
		mediaId,
		season: 0,
		episode: 0,
		at,
		instance
	});

	it('a shared film is caught up and kept in sync like a show — and never confused with a show of the same id', async () => {
		share(owner.householdId, owner.id, { source: 'tmdb', mediaId: '603', mediaType: 'movie', title: 'The Matrix' });
		const f = fakeFloppy({
			[owner.id]: [film('603', NOW - 30 * 24 * HOUR, 1), play('603', 1, 1, NOW - HOUR, 2)] // a *show* numbered 603 too
		});
		const back = await backfillShow(owner.householdId, 'tmdb', '603', f.ops, 'movie');
		expect(back.mirrored).toBe(1);
		expect(f.posts.map((p) => [p.user, p.play.mediaType, p.play.mediaId])).toEqual([[wife.id, 'movie', '603']]);

		// The ongoing pass: a new viewing of the film carries; the show's play doesn't (not shared).
		f.plays.set(owner.id, [...f.plays.get(owner.id)!, film('603', NOW - 2 * HOUR, 3)]);
		const sum = await reconcileHousehold(owner.householdId, f.ops, NOW);
		expect(sum.mirrored).toBe(1);
		expect(f.posts.at(-1)!.play).toMatchObject({ mediaType: 'movie', mediaId: '603', at: NOW - 2 * HOUR });
		expect(f.posts.some((p) => p.play.mediaType === 'tv')).toBe(false);
	});
});
