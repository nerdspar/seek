import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase, db } from '../db';
import { duration, seekCollectionCounts, seekDiary, seekDiaryOffset, seekStats, seekUpcoming, streaks } from './stats';

beforeEach(() => {
	const d = openDatabase(':memory:');
	d.exec("INSERT INTO households (id, name, created_at) VALUES (1, 'Home', 'x')");
	d.exec("INSERT INTO users (id, household_id, email, name, role, password_hash, created_at) VALUES (1, 1, 'a@x', 'A', 'owner', 'h', 'x')");
	useDatabase(d);
	d.exec(`INSERT INTO titles (media_type, tmdb_id, title, genres, networks, origin_country, runtime, refresh_after) VALUES
		('tv', 1, 'Lanterns', '["Drama"]', '["HBO"]', '["US"]', 50, 'x'),
		('tv', 2, 'Re:ZERO', '["Animation"]', '["AT-X"]', '["JP"]', 24, 'x'),
		('movie', 3, 'The Matrix', '["Action"]', '[]', '["US"]', 136, 'x')`);
	d.exec(`INSERT INTO episodes (tmdb_id, season, episode, title, air_date, runtime) VALUES
		(1, 1, 1, 'Pilot', '2026-08-17', 60), (1, 1, 2, 'Two', '2026-08-24', NULL), (1, 1, 3, 'Three', '2026-10-20', NULL),
		(2, 1, 1, 'Start', '2016-04-04', 25)`);
	d.exec(`INSERT INTO tracked (user_id, media_type, tmdb_id, status, score, added_at, updated_at) VALUES
		(1, 'tv', 1, 1, 9, 'x', '2026-01-01T00:00:00Z'), (1, 'tv', 2, 3, NULL, 'x', '2026-03-01T00:00:00Z'), (1, 'movie', 3, 3, 8, 'x', '2025-06-01T00:00:00Z')`);
	const p = d.prepare("INSERT INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, created_at) VALUES (1, ?, ?, ?, ?, ?, 'import', 'x')");
	p.run('tv', 1, 1, 1, '2026-09-03T20:00:00Z'); // Thursday, 60 min (episode runtime)
	p.run('tv', 1, 1, 2, '2026-09-04T20:00:00Z'); // Friday, 60 min (no runtime: its season's average)
	p.run('tv', 2, 1, 1, '2026-09-04T22:00:00Z'); // 25 min
	p.run('movie', 3, null, null, '2025-06-01T20:00:00Z'); // last year
});
afterEach(() => useDatabase(null));

describe('duration and streaks', () => {
	it('formats like Profile did', () => {
		expect(duration(34374)).toBe('572h 54min');
		expect(duration(321438)).toBe('5,357h 18min');
		expect(duration(45)).toBe('45min');
		expect(duration(120)).toBe('2h');
	});
	it('counts the run ending today or yesterday, and the longest run', () => {
		const days = new Set(['2026-10-08', '2026-10-07', '2026-09-01', '2026-09-02', '2026-09-03']);
		expect(streaks(days, '2026-10-09')).toEqual({ current: 2, longest: 3 });
		expect(streaks(new Set(['2026-10-01']), '2026-10-09')).toEqual({ current: 0, longest: 1 });
	});
});

describe('seekStats', () => {
	it("adds up this year's plays with their runtimes, split into shows, anime and films", () => {
		const s = seekStats(1, 1, 'this_year', new Date('2026-10-09T12:00:00Z'));
		expect(s).toMatchObject({ plays: 3, minutes: 145, counts: { tv: 1, anime: 1, movie: 0, total: 2 }, completed: 1 });
		expect(s.topGenres).toEqual([{ name: 'Drama', duration: '2h' }, { name: 'Animation', duration: '25min' }]);
		expect(s.topTitles[0]).toMatchObject({ title: 'Lanterns', plays: 2, duration: '2h' });
		expect(s.topStudios[0]).toEqual({ name: 'HBO', watched: '2h', shows: 1 });
		expect(s.topRated.map((r) => [r.title, r.score])).toEqual([['Lanterns', 9], ['The Matrix', 8]]);
		expect(s.monthly.all[8]).toBe(2); // 145 min in September
		expect(s.weekday.find((w) => w.label === 'Fri')?.hours).toBe(1.42);
	});
	it('an episode with no runtime takes its season’s average, then the show’s, before the listed runtime', () => {
		db().exec("INSERT INTO episodes (tmdb_id, season, episode, runtime, air_date) VALUES (1, 2, 1, NULL, '2026-09-01')");
		db().exec("INSERT INTO plays (user_id, media_type, tmdb_id, season, episode, watched_at, source, created_at) VALUES (1, 'tv', 1, 2, 1, '2026-09-10T20:00:00Z', 'seek', 'x')");
		// Season 2 has no runtimes at all: the show's average over its episodes (60), not its listed 50.
		expect(seekStats(1, 1, 'this_year', new Date('2026-10-09T12:00:00Z')).minutes).toBe(205);
	});

	it('completed counts what you finished in the period: by its last play, not when its record last changed', () => {
		// Re:ZERO (Completed) was last played this September; touching its record changes nothing.
		db().exec("UPDATE tracked SET updated_at = '2026-10-01T00:00:00Z' WHERE tmdb_id = 3");
		const year = seekStats(1, 1, 'this_year', new Date('2026-10-09T12:00:00Z'));
		expect(year.completed).toBe(1); // Re:ZERO; The Matrix was finished last year
		expect(seekStats(1, 1, 'last_year', new Date('2026-10-09T12:00:00Z')).completed).toBe(1);
		expect(seekStats(1, 1, 'all_time', new Date('2026-10-09T12:00:00Z')).completed).toBe(2);
	});

	it('all time includes last year’s film', () => {
		expect(seekStats(1, 1, 'all_time', new Date('2026-10-09T12:00:00Z')).counts.movie).toBe(1);
	});
});

describe('collection, diary and upcoming', () => {
	it('counts what you track by kind', () => {
		expect(seekCollectionCounts(1, 1)).toEqual({ tv: 1, anime: 1, movie: 1 });
	});
	it('lists plays by day, newest first, with episode codes and titles', () => {
		const d = seekDiary(1, 1, 0, 2);
		expect(d.total).toBe(3);
		expect(d.hasMore).toBe(true);
		expect(d.days[0].entries.map((e) => `${e.showTitle} ${e.code} ${e.episodeTitle}`)).toEqual(['Re:ZERO S01E01 Start', 'Lanterns S01E02 Two']);
	});
	it('jumps to a date: that day, or the nearest earlier day with plays', () => {
		expect(seekDiaryOffset(1, '2027-01-01')).toBe(0);
		expect(seekDiaryOffset(1, '2026-09-04')).toBe(0);
		expect(seekDiaryOffset(1, '2026-09-03')).toBe(1);
		expect(seekDiaryOffset(1, '2026-01-01')).toBe(2);
	});
	it('upcoming: tracked shows’ episodes in the window, date-only marked as such', () => {
		const up = seekUpcoming(1, Date.parse('2026-10-09T12:00:00Z'));
		expect(up.map((u) => `${u.title} S${u.season}E${u.episode} ${u.hasTime}`)).toEqual(['Lanterns S1E3 false']);
		// Date only: anchored at midday UTC so it's Oct 20 in every US time zone, not the 19th.
		expect(up[0].start).toBe('2026-10-20T12:00:00.000Z');
	});
});
