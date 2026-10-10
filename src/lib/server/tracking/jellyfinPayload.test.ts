import { describe, it, expect } from 'vitest';
import { readJellyfin } from './jellyfinPayload';

const reZero = (event: string, extra: Record<string, unknown> = {}) => ({
	Event: event,
	Item: {
		Name: 'Episode #4.17',
		Type: 'Episode',
		SeriesName: 'Re:ZERO -Starting Life in Another World-',
		ParentIndexNumber: 4,
		IndexNumber: 17,
		RunTimeTicks: 14787300000,
		ProviderIds: { Imdb: 'tt42121826' },
		ExternalUrls: [{ Name: 'IMDb', Url: 'https://www.imdb.com/title/tt42121826' }, { Name: 'TMDB', Url: 'https://www.themoviedb.org/tv/65942/season/4/episode/17' }]
	},
	...extra
});

describe('readJellyfin', () => {
	it("reads a manual 'played' tick on an episode: the show from the TMDB link, Jellyfin's numbering, the episode's own ids", () => {
		expect(readJellyfin(reZero('MarkPlayed'))).toEqual({
			action: 'play',
			kind: 'tv',
			tmdbId: 65942,
			season: 4,
			episode: 17,
			imdbId: 'tt42121826',
			tvdbId: null,
			title: 'Re:ZERO -Starting Life in Another World- S4E17',
			playedAt: null,
			event: 'MarkPlayed'
		});
		expect(readJellyfin(reZero('MarkUnplayed'))).toMatchObject({ action: 'unplay' });
	});

	it('counts playback stopped past 80% as a play, and earlier stops as nothing', () => {
		expect(readJellyfin(reZero('Stop', { PlaybackPositionTicks: 12_000_000_000 }))).toMatchObject({ action: 'play' });
		expect(readJellyfin(reZero('Stop', { PlaybackPositionTicks: 6_000_000_000 }))).toMatchObject({
			action: 'ignore',
			reason: 'stopped before the end (at 41%)',
			notable: { event: 'Stop', title: 'Re:ZERO -Starting Life in Another World- S4E17' }
		});
		expect(readJellyfin(reZero('Play'))).toMatchObject({ action: 'ignore' });
	});

	it("treats the checkmark's UserDataSaved as a mark, and other saves as nothing", () => {
		const tick = reZero('UserDataSaved', { SaveReason: 'TogglePlayed' });
		(tick.Item as Record<string, unknown>).UserData = { Played: true, LastPlayedDate: '2026-10-09T23:00:00Z' };
		expect(readJellyfin(tick)).toMatchObject({ action: 'play', event: 'MarkPlayed', playedAt: '2026-10-09T23:00:00Z' });
		expect(readJellyfin(reZero('UserDataSaved', { SaveReason: 'PlaybackProgress' }))).toMatchObject({ action: 'ignore' });
	});

	it('reads a film by its TMDB id', () => {
		const film = { Event: 'MarkPlayed', Item: { Name: 'The Matrix', Type: 'Movie', ProviderIds: { Tmdb: '603', Imdb: 'tt0133093' } } };
		expect(readJellyfin(film)).toMatchObject({ action: 'play', kind: 'movie', tmdbId: 603, season: null, title: 'The Matrix' });
		expect(readJellyfin({ Event: 'MarkPlayed', Item: { Type: 'Series' } })).toMatchObject({ action: 'ignore' });
	});
});
