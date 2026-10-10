import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { db, openDatabase, useDatabase } from '../db';
import * as users from '../users';
import { isShared, share } from './shared';
import {
	decide,
	fillTitles,
	noteShared,
	newShowsMode,
	pendingShows,
	scanNewShows,
	setNewShowsMode,
	settle,
	type Added,
	type Deps
} from './newShows';

let owner: users.User;
let wife: users.User;
const H = () => owner.householdId;
const START = Date.parse('2026-10-04T12:00:00Z');

function deps(adds: Record<number, Added[]> = {}) {
	const shared: string[] = [];
	const told: { user: number; titles: (string | null)[] }[] = [];
	const d: Deps = {
		recentAdds: async (u) => adds[u.id] ?? [],
		share: (h, userId, show) => {
			share(h, userId, show);
			shared.push(show.mediaId);
		},
		notify: async (u, shows) => void told.push({ user: u.id, titles: shows.map((s) => s.title) })
	};
	return { d, shared, told };
}
const added = (mediaId: string, title: string, at: number): Added => ({ source: 'tmdb', mediaId, title, addedAt: at });
const show = (mediaId: string, title = `Show ${mediaId}`) => ({ source: 'tmdb', mediaId, title });

beforeEach(async () => {
	process.env.SEEK_TOKEN_KEY = 'test-token-key';
	useDatabase(openDatabase(':memory:'));
	owner = await users.createOwner({ email: 'o@x.co', name: 'Scott', password: 'password-1' });
	const { token } = users.createInvite(owner, 'w@x.co');
	wife = await users.acceptInvite(token, { name: 'Wife', password: 'password-2' });
	db().prepare('UPDATE households SET new_shows_since = ? WHERE id = ?').run(new Date(START).toISOString(), H());
});
afterEach(() => useDatabase(null));

describe('settling a new show', () => {
	it('asks by default: it waits in the inbox, nothing is shared', () => {
		const { d, shared } = deps();
		expect(newShowsMode(H())).toBe('ask');
		expect(settle(H(), owner.id, show('1', 'Lanterns'), d)).toBe('pending');
		expect(pendingShows(H())).toEqual([show('1', 'Lanterns')]);
		expect(shared).toEqual([]);
	});

	it('follows the household setting', () => {
		const { d, shared } = deps();
		setNewShowsMode(H(), 'together');
		expect(settle(H(), owner.id, show('1'), d)).toBe('together');
		expect(isShared(H(), 'tmdb', '1')).toBe(true);
		setNewShowsMode(H(), 'solo');
		expect(settle(H(), owner.id, show('2'), d)).toBe('solo');
		expect(pendingShows(H())).toEqual([]);
		expect(shared).toEqual(['1']);
	});

	it('leaves shows that are already shared or answered alone', () => {
		const { d } = deps();
		share(H(), owner.id, show('1'));
		expect(settle(H(), wife.id, show('1'), d)).toBe('known');
		decide(H(), owner.id, show('2'), 'solo', d);
		expect(settle(H(), wife.id, show('2'), d)).toBe('known');
	});

	it("either person's answer holds for both; together shares and leaves the inbox", () => {
		const { d, shared } = deps();
		settle(H(), owner.id, show('1'), d);
		settle(H(), owner.id, show('2'), d);
		decide(H(), wife.id, show('1'), 'together', d);
		decide(H(), wife.id, show('2'), 'solo', d);
		expect(shared).toEqual(['1']);
		expect(pendingShows(H())).toEqual([]);
	});
});

describe('titles', () => {
	it('fills in a title the inbox was missing, once, and keeps it', async () => {
		const { d } = deps();
		settle(H(), owner.id, { source: 'tmdb', mediaId: '291361', title: null }, d);
		const lookups: string[] = [];
		const titleOf = async (s: { mediaId: string }) => (lookups.push(s.mediaId), 'The Copenhagen Test');
		await fillTitles(H(), titleOf);
		await fillTitles(H(), titleOf);
		expect(pendingShows(H())).toEqual([{ source: 'tmdb', mediaId: '291361', title: 'The Copenhagen Test' }]);
		expect(lookups).toEqual(['291361']);
	});

	it('leaves it blank (and tries again later) when the lookup fails', async () => {
		const { d } = deps();
		settle(H(), owner.id, { source: 'tmdb', mediaId: '1', title: null }, d);
		await fillTitles(H(), async () => {
			throw new Error('Floppy down');
		});
		expect(pendingShows(H())[0].title).toBeNull();
	});
});

describe('answering from the show page', () => {
	it('the Together chip takes a show out of the inbox; turning it off counts as solo', () => {
		const { d } = deps();
		settle(H(), owner.id, show('1'), d);
		settle(H(), owner.id, show('2'), d);
		noteShared(H(), owner.id, show('1'), true);
		noteShared(H(), owner.id, show('2'), false);
		expect(pendingShows(H())).toEqual([]);
		expect(settle(H(), wife.id, show('2'), d)).toBe('known');
	});
});

describe('finding shows added outside Seek', () => {
	it('settles shows added since the starting line, from everyone, and tells everyone once', async () => {
		const { d, told } = deps({
			[owner.id]: [added('9', 'Old', START - 1000), added('1', 'Cupertino', START + 1000)],
			[wife.id]: [added('1', 'Cupertino', START + 2000), added('2', 'Murder 101', START + 3000)]
		});
		const fresh = await scanNewShows(H(), [owner, wife], d, START + 5000);
		expect(fresh.map((s) => s.title)).toEqual(['Cupertino', 'Murder 101']);
		expect(told).toEqual([
			{ user: owner.id, titles: ['Cupertino', 'Murder 101'] },
			{ user: wife.id, titles: ['Cupertino', 'Murder 101'] }
		]);
		// Next pass: already waiting, so nobody is told again.
		expect(await scanNewShows(H(), [owner, wife], d, START + 9000)).toEqual([]);
		expect(told).toHaveLength(2);
	});

	it('the first pass for a household only sets the starting line', async () => {
		db().prepare('UPDATE households SET new_shows_since = NULL WHERE id = ?').run(H());
		const { d } = deps({ [owner.id]: [added('1', 'Anything', START)] });
		expect(await scanNewShows(H(), [owner, wife], d, START + 1)).toEqual([]);
		expect(pendingShows(H())).toEqual([]);
	});

	it('one person’s list failing to read does not stop the other', async () => {
		const { d } = deps({ [wife.id]: [added('2', 'Two', START + 1)] });
		d.recentAdds = vi.fn(async (u: users.User) => {
			if (u.id === owner.id) throw new Error('down');
			return [added('2', 'Two', START + 1)];
		});
		expect((await scanNewShows(H(), [owner, wife], d, START + 9)).map((s) => s.mediaId)).toEqual(['2']);
	});
});
