import { describe, it, expect } from 'vitest';
import { matchEpisode } from './arrMatch';
import type { ArrEpisode } from '$lib/server/arr';

const ep = (over: Partial<ArrEpisode>): ArrEpisode => ({
	id: 0,
	seasonNumber: 1,
	episodeNumber: 1,
	title: 'E',
	hasFile: false,
	monitored: true,
	episodeFileId: null,
	airDateUtc: null,
	file: null,
	...over
});

describe('matchEpisode', () => {
	it('matches by air date across a season renumber (the Bake Off / Re:ZERO case)', () => {
		// Floppy numbers this as S1E07 (TMDB), Sonarr files the same broadcast as
		// S8E07; a different Sonarr episode shares the number S1E07 but aired years
		// earlier. Air date must win.
		const sonarr = [
			ep({ id: 1, seasonNumber: 1, episodeNumber: 7, airDateUtc: '2010-09-28T19:00:00Z' }),
			ep({ id: 2, seasonNumber: 8, episodeNumber: 7, airDateUtc: '2017-10-10T19:00:00Z' })
		];
		const floppy = { seasonNumber: 1, episodeNumber: 7, airDate: '2017-10-10T07:59:00Z' };
		expect(matchEpisode(floppy, sonarr)?.id).toBe(2);
	});

	it('absorbs timezone skew within the window', () => {
		const sonarr = [ep({ id: 5, airDateUtc: '2016-09-04T19:00:00Z' })];
		// Floppy local datetime a few hours off, same broadcast.
		const floppy = { seasonNumber: 1, episodeNumber: 23, airDate: '2016-09-04T08:00:00Z' };
		expect(matchEpisode(floppy, sonarr)?.id).toBe(5);
	});

	it('does not match a date that is a whole week away', () => {
		const sonarr = [ep({ id: 9, seasonNumber: 2, episodeNumber: 1, airDateUtc: '2016-09-11T19:00:00Z' })];
		const floppy = { seasonNumber: 1, episodeNumber: 99, airDate: '2016-09-04T19:00:00Z' };
		expect(matchEpisode(floppy, sonarr)).toBeNull();
	});

	it('disambiguates a same-day season drop by episode number', () => {
		// Whole season released on one date — every episode shares it, so nearest
		// date is ambiguous and must fall through to the episode number.
		const day = '2022-05-27T07:00:00Z';
		const sonarr = [
			ep({ id: 1, seasonNumber: 4, episodeNumber: 1, airDateUtc: day }),
			ep({ id: 2, seasonNumber: 4, episodeNumber: 2, airDateUtc: day }),
			ep({ id: 3, seasonNumber: 4, episodeNumber: 3, airDateUtc: day })
		];
		expect(matchEpisode({ seasonNumber: 4, episodeNumber: 2, airDate: day }, sonarr)?.id).toBe(2);
		expect(matchEpisode({ seasonNumber: 4, episodeNumber: 3, airDate: day }, sonarr)?.id).toBe(3);
	});

	it('falls back to (season, episode) number when there is no air date', () => {
		const sonarr = [ep({ id: 3, seasonNumber: 2, episodeNumber: 4 })];
		expect(matchEpisode({ seasonNumber: 2, episodeNumber: 4, airDate: null }, sonarr)?.id).toBe(3);
	});

	it('returns null when nothing matches', () => {
		expect(matchEpisode({ seasonNumber: 9, episodeNumber: 9, airDate: null }, [ep({ id: 1 })])).toBeNull();
	});
});
