import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, openDatabase, useDatabase } from '../db';
import * as users from '../users';
import { runAs } from '../userctx';
import { recordPlay, watchers } from '../tracking/write';
import { backfillShow } from './mirror';
import { isShared } from './shared';
import { recentAdds, setShared } from './run';

let owner: users.User;
let wife: users.User;
const H = () => owner.householdId;

const playsOf = (userId: number, kind = 'tv', id = 10) =>
	(db().prepare('SELECT season, episode, watched_at FROM plays WHERE user_id = ? AND media_type = ? AND tmdb_id = ? ORDER BY season, episode, watched_at').all(userId, kind, id) as {
		season: number | null;
		episode: number | null;
		watched_at: string;
	}[]).map((p) => (p.season === null ? p.watched_at : `S${p.season}E${p.episode} ${p.watched_at}`));
const tracks = (userId: number, kind = 'tv', id = 10) => Boolean(db().prepare('SELECT 1 FROM tracked WHERE user_id = ? AND media_type = ? AND tmdb_id = ?').get(userId, kind, id));

beforeEach(async () => {
	process.env.SEEK_TOKEN_KEY = 'test-token-key';
	useDatabase(openDatabase(':memory:'));
	owner = await users.createOwner({ email: 'o@x.co', name: 'Scott', password: 'password-1' });
	const { token } = users.createInvite(owner, 'w@x.co');
	wife = await users.acceptInvite(token, { name: 'Wife', password: 'password-2' });
});
afterEach(() => useDatabase(null));

describe('sharing a show', () => {
	it("catches each of you up on the other's episodes once, without carrying back or doubling", () => {
		recordPlay(owner.id, 'tv', 10, 1, 1, '2026-10-01T20:00:00Z');
		recordPlay(owner.id, 'tv', 10, 1, 2, '2026-10-02T20:00:00Z');
		recordPlay(owner.id, 'tv', 10, 1, 2, '2026-10-05T20:00:00Z'); // a rewatch: one catch-up play, not two
		recordPlay(wife.id, 'tv', 10, 1, 1, '2026-09-30T20:00:00Z');
		recordPlay(wife.id, 'tv', 10, 1, 3, '2026-10-03T20:00:00Z');
		expect(setShared(H(), owner.id, { source: 'tmdb', mediaId: '10', title: 'Lanterns' }, true)).toBe(true);
		expect(playsOf(wife.id)).toEqual(['S1E1 2026-09-30T20:00:00Z', 'S1E2 2026-10-02T20:00:00Z', 'S1E3 2026-10-03T20:00:00Z']);
		expect(playsOf(owner.id)).toEqual([
			'S1E1 2026-10-01T20:00:00Z',
			'S1E2 2026-10-02T20:00:00Z',
			'S1E2 2026-10-05T20:00:00Z',
			'S1E3 2026-10-03T20:00:00Z'
		]);
		// Already shared: no second catch-up.
		setShared(H(), wife.id, { source: 'tmdb', mediaId: '10' }, true);
		expect(playsOf(wife.id)).toHaveLength(3);
	});

	it('puts it on both lists even with nothing watched yet', () => {
		db().prepare("INSERT INTO tracked (user_id, media_type, tmdb_id, status, added_at, updated_at) VALUES (?, 'tv', 10, 0, 'x', 'x')").run(owner.id);
		setShared(H(), owner.id, { source: 'tmdb', mediaId: '10' }, true);
		expect(tracks(wife.id)).toBe(true);
	});

	it('then every mark counts for both; unsharing keeps the history', () => {
		setShared(H(), owner.id, { source: 'tmdb', mediaId: '10' }, true);
		expect(watchers(owner, 'tmdb', '10', 'tv').sort()).toEqual([owner.id, wife.id].sort());
		expect(watchers(owner, 'tmdb', '11', 'tv')).toEqual([owner.id]);
		recordPlay(wife.id, 'tv', 10, 1, 1);
		setShared(H(), owner.id, { source: 'tmdb', mediaId: '10' }, false);
		expect(isShared(H(), 'tmdb', '10')).toBe(false);
		expect(playsOf(wife.id)).toHaveLength(1);
	});

	it('a film is kept apart from a show with the same number', () => {
		recordPlay(owner.id, 'movie', 10, null, null, '2026-10-01T20:00:00Z');
		recordPlay(owner.id, 'tv', 10, 1, 1, '2026-10-01T20:00:00Z');
		setShared(H(), owner.id, { source: 'tmdb', mediaId: '10', mediaType: 'movie' }, true);
		expect(playsOf(wife.id, 'movie')).toEqual(['2026-10-01T20:00:00Z']);
		expect(playsOf(wife.id, 'tv')).toEqual([]);
		expect(backfillShow(H(), 'tmdb', '10', 'movie').mirrored).toBe(0);
	});
});

describe('new shows from Seek’s own list', () => {
	it("reads someone's newest shows, with titles where Seek has them", () => {
		db().exec("INSERT INTO titles (media_type, tmdb_id, title, refresh_after) VALUES ('tv', 2, 'Murder 101', 'x')");
		const add = db().prepare("INSERT INTO tracked (user_id, media_type, tmdb_id, status, added_at, updated_at) VALUES (?, ?, ?, 0, ?, 'x')");
		add.run(owner.id, 'tv', 1, '2026-10-01T00:00:00Z');
		add.run(owner.id, 'tv', 2, '2026-10-02T00:00:00Z');
		add.run(owner.id, 'movie', 3, '2026-10-03T00:00:00Z');
		expect(runAs(owner, () => recentAdds(owner.id))).toEqual([
			{ source: 'tmdb', mediaId: '2', title: 'Murder 101', addedAt: Date.parse('2026-10-02T00:00:00Z') },
			{ source: 'tmdb', mediaId: '1', title: null, addedAt: Date.parse('2026-10-01T00:00:00Z') }
		]);
	});
});
