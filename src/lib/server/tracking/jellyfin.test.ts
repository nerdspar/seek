import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const find = vi.fn<(path: string, params: Record<string, string>) => Promise<unknown>>();
vi.mock('../tmdb', () => ({ tmdb: (path: string, params: Record<string, string>) => find(path, params) }));
const floppyCall = vi.fn<(path: string, opts: unknown) => Promise<unknown>>(async () => ({}));
vi.mock('../floppy', () => ({ floppy: (path: string, opts: unknown) => floppyCall(path, opts) }));
const markEp = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}));
const markMovie = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}));
vi.mock('../api', () => ({
	markEpisodeWatched: (...a: unknown[]) => markEp(...a),
	markMovieWatched: (...a: unknown[]) => markMovie(...a),
	watchMoviePath: (s: string, id: string) => `/api/v1/media/movie/${s}/${id}/watch/`
}));
vi.mock('../catalog/refresh', () => ({ refreshTitle: async () => {} }));
let members: { id: number }[] = [];
vi.mock('../household/mirror', () => ({ mirrorMembers: () => members }));

import { openDatabase, useDatabase, db } from '../db';
import { handleJellyfin, recentUnmatched } from './jellyfin';
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
	for (const f of [find, floppyCall, markEp, markMovie]) f.mockClear();
	find.mockResolvedValue({ tv_episode_results: [{ show_id: 65942, season_number: 1, episode_number: 83 }] });
	members = [];
});
afterEach(() => useDatabase(null));

describe('handleJellyfin', () => {
	it("records Re:Zero's S4E17 as TMDB's S1E83 (found by the episode's own IMDb id) and passes it on to Floppy", async () => {
		expect(await handleJellyfin(me, reZero('MarkPlayed'))).toEqual({ ok: true, did: 'recorded' });
		expect(find).toHaveBeenCalledWith('/find/tt42121826', { external_source: 'imdb_id' });
		expect(plays()).toEqual([{ user_id: 1, tmdb_id: 65942, season: 1, episode: 83, source: 'jellyfin' }]);
		expect(markEp).toHaveBeenCalledWith('tmdb', '65942', 1, 83);
	});

	it('ignores the second event of one viewing, and undoes on unplay', async () => {
		await handleJellyfin(me, reZero('MarkPlayed'));
		expect(await handleJellyfin(me, reZero('MarkPlayed'))).toEqual({ ok: true, did: 'duplicate' });
		expect(markEp).toHaveBeenCalledTimes(1);
		expect(await handleJellyfin(me, reZero('MarkUnplayed'))).toEqual({ ok: true, did: 'removed' });
		expect(plays()).toEqual([]);
		expect(floppyCall).toHaveBeenCalledWith('/api/v1/media/tv/tmdb/65942/1/episodes/83/watch/', { method: 'DELETE' });
	});

	it("keeps what it can't match in a list, never guessing", async () => {
		find.mockResolvedValue({});
		expect(await handleJellyfin(me, reZero('MarkPlayed'))).toEqual({ ok: true, did: 'unmatched' });
		expect(plays()).toEqual([]);
		expect(recentUnmatched(1)[0]).toMatchObject({ event: 'MarkPlayed', title: 'Re:ZERO S4E17' });
		expect(markEp).not.toHaveBeenCalled();
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
		expect(markMovie).toHaveBeenCalledWith('tmdb', '603');
	});

	it('does nothing for progress events', async () => {
		expect(await handleJellyfin(me, reZero('Play'))).toMatchObject({ did: 'ignored' });
		expect(plays()).toEqual([]);
	});
});
