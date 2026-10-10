import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const find = vi.fn<(path: string, params: Record<string, string>) => Promise<unknown>>();
vi.mock('../tmdb', () => ({ tmdb: (path: string, params: Record<string, string>) => find(path, params) }));
vi.mock('../catalog/refresh', () => ({ refreshTitle: async () => {} }));
let members: { id: number }[] = [];
vi.mock('../household/mirror', () => ({ mirrorMembers: () => members }));

import { openDatabase, useDatabase, db } from '../db';
import { handleJellyfin, recentWebhook } from './jellyfin';
import type { User } from '../users';

const me = { id: 1, householdId: 1 } as User;
const reZero = (event: string) => ({
	Event: event,
	Item: {
		Type: 'Episode',
		SeriesName: 'Re:ZERO',
		ParentIndexNumber: 4,
		IndexNumber: 17,
		ProviderIds: { Imdb: 'tt42121826' },
		ExternalUrls: [{ Name: 'TMDB', Url: 'https://www.themoviedb.org/tv/65942/season/4/episode/17' }]
	}
});
const plays = () => db().prepare('SELECT user_id, tmdb_id, season, episode, source FROM plays ORDER BY user_id, id').all();

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x'), (2, 1, 'b@x', 'B', 'member', 'h', 'x')");
	useDatabase(d);
	find.mockClear();
	find.mockResolvedValue({ tv_episode_results: [{ show_id: 65942, season_number: 1, episode_number: 83 }] });
	members = [];
});
afterEach(() => useDatabase(null));

describe('handleJellyfin', () => {
	it("records Re:Zero's S4E17 as TMDB's S1E83 (found by the episode's own IMDb id) ", async () => {
		expect(await handleJellyfin(me, reZero('MarkPlayed'))).toEqual({ ok: true, did: 'recorded' });
		expect(find).toHaveBeenCalledWith('/find/tt42121826', { external_source: 'imdb_id' });
		expect(plays()).toEqual([{ user_id: 1, tmdb_id: 65942, season: 1, episode: 83, source: 'jellyfin' }]);
	});

	it('ignores the second event of one viewing, and undoes on unplay', async () => {
		await handleJellyfin(me, reZero('MarkPlayed'));
		expect(await handleJellyfin(me, reZero('MarkPlayed'))).toEqual({ ok: true, did: 'duplicate' });
		expect(await handleJellyfin(me, reZero('MarkUnplayed'))).toEqual({ ok: true, did: 'removed' });
		expect(plays()).toEqual([]);
	});

	it("keeps what it can't match in a list, never guessing", async () => {
		find.mockResolvedValue({});
		expect(await handleJellyfin(me, reZero('MarkPlayed'))).toEqual({ ok: true, did: 'unmatched' });
		expect(plays()).toEqual([]);
		expect(recentWebhook(1)[0]).toMatchObject({ event: 'MarkPlayed', title: 'Re:ZERO S4E17', outcome: 'unmatched' });
	});

	it("falls back to the show's TMDB link and Jellyfin's numbers when the episode exists in Seek's copy", async () => {
		find.mockResolvedValue({});
		db().exec("INSERT INTO titles (media_type, tmdb_id, refreshed_at, refresh_after) VALUES ('tv', 65942, 'x', 'x')");
		db().exec('INSERT INTO episodes (tmdb_id, season, episode) VALUES (65942, 4, 17)');
		expect(await handleJellyfin(me, reZero('MarkPlayed'))).toEqual({ ok: true, did: 'recorded' });
		expect(plays()).toEqual([{ user_id: 1, tmdb_id: 65942, season: 4, episode: 17, source: 'jellyfin' }]);
	});

	it('a shared show counts for the household; a film is found by its TMDB id', async () => {
		db().exec("INSERT INTO shared_shows (household_id, media_type, source, media_id, title, created_at) VALUES (1, 'tv', 'tmdb', '65942', 'Re:ZERO', 'x')");
		members = [{ id: 1 }, { id: 2 }];
		await handleJellyfin(me, reZero('MarkPlayed'));
		expect((plays() as { user_id: number }[]).map((p) => p.user_id)).toEqual([1, 2]);

		await handleJellyfin(me, { Event: 'MarkPlayed', Item: { Type: 'Movie', Name: 'The Matrix', ProviderIds: { Tmdb: '603' } } });
	});

	it('does nothing for progress events, and keeps them out of the activity list', async () => {
		expect(await handleJellyfin(me, reZero('Play'))).toMatchObject({ did: 'ignored' });
		expect(plays()).toEqual([]);
		expect(recentWebhook(1)).toEqual([]);
	});

	it('keeps what each telling call did, newest first: so a play that did not land can be traced', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		await handleJellyfin(me, reZero('MarkPlayed'));
		await handleJellyfin(me, reZero('MarkPlayed'));
		const stop = reZero('Stop');
		await handleJellyfin(me, { ...stop, PlaybackPositionTicks: 6_000_000_000, Item: { ...stop.Item, RunTimeTicks: 12_000_000_000 } });
		expect(recentWebhook(1).map((r) => [r.outcome, r.detail])).toEqual([
			['ignored', 'stopped before the end (at 50%)'],
			['duplicate', 'TMDB 65942 S1E83, already recorded'],
			['recorded', 'TMDB 65942 S1E83']
		]);
		expect(recentWebhook(2)).toEqual([]);
	});

	it("finds an episode TMDB files under a second show by name, number and air date (Bake Off S17E03 → 87012 S10E03)", async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		db().exec(`INSERT INTO titles (media_type, tmdb_id, title, refreshed_at, refresh_after) VALUES
			('tv', 34549, 'The Great British Bake Off', 'x', 'x'), ('tv', 87012, 'The Great British Bake Off', 'x', 'x')`);
		db().exec(`INSERT INTO episodes (tmdb_id, season, episode, air_date) VALUES
			(34549, 7, 3, '2016-09-07'), (87012, 10, 2, '2026-09-29'), (87012, 10, 3, '2026-10-06')`);
		find.mockImplementation(async (path: string) => (path === '/search/tv' ? { results: [{ id: 87012, name: 'The Great British Bake Off' }] } : {}));
		const bakeOff = {
			Event: 'Stop',
			PlaybackPositionTicks: 40_000_000_000,
			Item: {
				Type: 'Episode',
				SeriesName: 'The Great British Bake Off',
				ParentIndexNumber: 17,
				IndexNumber: 3,
				RunTimeTicks: 45_000_000_000,
				PremiereDate: '2026-10-06T00:00:00.0000000Z',
				ProviderIds: {},
				ExternalUrls: [{ Name: 'TMDB', Url: 'https://www.themoviedb.org/tv/34549' }]
			}
		};
		expect(await handleJellyfin(me, bakeOff)).toEqual({ ok: true, did: 'recorded' });
		expect(plays()).toEqual([{ user_id: 1, tmdb_id: 87012, season: 10, episode: 3, source: 'jellyfin' }]);
	});

	it('never guesses when two episodes fit, and a repeated miss is one entry', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		db().exec(`INSERT INTO titles (media_type, tmdb_id, title, refreshed_at, refresh_after) VALUES
			('tv', 1, 'Twin', 'x', 'x'), ('tv', 2, 'Twin', 'x', 'x')`);
		db().exec(`INSERT INTO episodes (tmdb_id, season, episode, air_date) VALUES (1, 1, 3, '2026-10-06'), (2, 1, 3, '2026-10-06')`);
		find.mockResolvedValue({});
		const twin = { Event: 'MarkPlayed', Item: { Type: 'Episode', SeriesName: 'Twin', ParentIndexNumber: 5, IndexNumber: 3, PremiereDate: '2026-10-06T00:00:00Z', ProviderIds: {} } };
		expect(await handleJellyfin(me, twin)).toMatchObject({ did: 'unmatched' });
		expect(await handleJellyfin(me, { ...twin, Event: 'Stop', PlaybackPositionTicks: 10, Item: { ...twin.Item, UserData: { Played: true } } })).toMatchObject({ did: 'unmatched' });
		expect(plays()).toEqual([]);
		expect(recentWebhook(1)).toHaveLength(1);
		expect(recentWebhook(1)[0]).toMatchObject({ outcome: 'unmatched', event: 'Stop' });
	});
});
