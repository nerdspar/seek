import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase, db } from './db';
import { exportFor } from './exportData';
import { share } from './household/shared';
import type { User } from './users';

const me: User = { id: 1, householdId: 1, email: 'a@x', name: 'Scott', role: 'owner', sessionVersion: 1, emailVerified: true };

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'Scott', 'owner', 'h', 'x'), (2, 1, 'b@x', 'Jenny', 'member', 'h', 'x')");
	const track = d.prepare("INSERT INTO tracked (user_id, media_type, tmdb_id, status, score, notes, added_at, updated_at) VALUES (?, ?, ?, ?, ?, '', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')");
	track.run(1, 'tv', 10, 1, 8.5);
	track.run(1, 'movie', 603, 3, null);
	track.run(2, 'tv', 99, 1, null);
	const play = d.prepare("INSERT INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'x')");
	play.run(1, 'tv', 10, 1, 2, '2026-02-02T20:00:00Z', 'seek');
	play.run(1, 'tv', 10, 1, 1, '2026-02-01T20:00:00Z', 'import');
	play.run(1, 'movie', 603, null, null, '2026-03-01T20:00:00Z', 'jellyfin');
	play.run(2, 'tv', 99, 1, 1, '2026-02-01T20:00:00Z', 'seek');
	useDatabase(d);
});
afterEach(() => useDatabase(null));

describe('exportFor', () => {
	it("is one person's tracked titles and plays, oldest play first, with totals", () => {
		const x = exportFor(me, new Date('2026-10-11T00:00:00Z'));
		expect(x.person).toEqual({ id: 1, name: 'Scott' });
		expect(x.tracked).toEqual([
			{ mediaType: 'movie', tmdbId: 603, status: 3, score: null, notes: '', addedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
			{ mediaType: 'tv', tmdbId: 10, status: 1, score: 8.5, notes: '', addedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' }
		]);
		expect(x.plays.map((p) => [p.tmdbId, p.season, p.episode, p.source])).toEqual([
			[10, 1, 1, 'import'],
			[10, 1, 2, 'seek'],
			[603, null, null, 'jellyfin']
		]);
		expect(x.totals).toEqual({ tracked: 2, plays: 3, shared: 0 });
	});

	it("includes the household's shared titles, solo answers and anime overrides", () => {
		share(1, 1, { source: 'tmdb', mediaId: '10', title: 'Lanterns' });
		db().exec("INSERT INTO show_choices (household_id, source, media_id, title, choice, user_id, created_at) VALUES (1, 'tmdb', '55', 'Mine', 'solo', 1, 'x'), (1, 'tmdb', '56', 'Ask', 'pending', 1, 'x')");
		db().exec("INSERT INTO anime_overrides (household_id, source, media_id, is_anime, user_id, created_at) VALUES (1, 'tmdb', '77', 1, 1, 'x')");
		const x = exportFor(me);
		expect(x.household.shared).toMatchObject([{ mediaType: 'tv', tmdbId: 10, title: 'Lanterns' }]);
		expect(x.household.solo).toEqual([{ mediaType: 'tv', tmdbId: 55 }]);
		expect(x.household.animeOverrides).toEqual([{ tmdbId: 77, isAnime: true }]);
		expect(x.totals.shared).toBe(1);
	});
});

describe('GET /api/export', () => {
	it('downloads your export as a file, and refuses without a session', async () => {
		const { GET } = await import('../../routes/api/export/+server');
		const { runAs } = await import('./userctx');
		await expect(GET({} as never)).rejects.toMatchObject({ status: 401 });
		const res = await runAs(me, () => GET({} as never));
		expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="seek-export-scott-\d{4}-\d{2}-\d{2}\.json"$/);
		expect((await res.json()).totals.plays).toBe(3);
	});
});
