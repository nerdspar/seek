import { describe, it, expect } from 'vitest';
import { isReview, playFromHistory, trackedFromList } from './importMap';

describe('trackedFromList', () => {
	it('takes status, rating, notes and dates from a Floppy list row', () => {
		expect(
			trackedFromList('tv', {
				item: { source: 'tmdb', media_id: '95350', title: 'Lanterns' },
				status: 1,
				score: 8.5,
				notes: 'with Jo',
				created_at: '2026-09-30T13:16:05.229802Z',
				progressed_at: '2026-10-04T02:04:47.672965Z'
			})
		).toEqual({ mediaType: 'tv', tmdbId: 95350, status: 1, score: 8.5, notes: 'with Jo', addedAt: '2026-09-30T13:16:05.229Z', updatedAt: '2026-10-04T02:04:47.672Z' });
	});

	it('sets aside anything Floppy holds under another source', () => {
		const r = trackedFromList('tv', { item: { source: 'tvdb', media_id: '5', title: 'Odd one' }, status: 1 });
		expect(isReview(r) && r).toEqual({ mediaType: 'tv', ref: 'tvdb:5', reason: 'not-tmdb', detail: 'Odd one' });
	});
});

describe('playFromHistory', () => {
	it('turns an episode play into a play keyed by Floppy’s play id', () => {
		expect(
			playFromHistory({
				media_type: 'episode',
				item: { source: 'tmdb', media_id: '258230', season_number: 1, episode_number: 6 },
				season_number: 1,
				episode_number: 6,
				played_at_local: '2026-10-09T16:21:10.009076-04:00',
				instance_id: 33970
			})
		).toEqual({ mediaType: 'tv', tmdbId: 258230, season: 1, episode: 6, watchedAt: '2026-10-09T20:21:10.009Z', externalKey: 'floppy:episode:33970' });
	});

	it('turns a film play into a play with no season or episode', () => {
		expect(
			playFromHistory({ media_type: 'movie', item: { source: 'tmdb', media_id: '1204680' }, played_at_local: '2026-09-07T12:13:00-04:00', instance_id: 132 })
		).toMatchObject({ mediaType: 'movie', tmdbId: 1204680, season: null, episode: null, externalKey: 'floppy:movie:132' });
	});

	it('skips other media, and sets aside plays with no date or no TMDB id', () => {
		expect(playFromHistory({ media_type: 'book', item: {} })).toBeNull();
		expect(playFromHistory({ media_type: 'episode', item: { source: 'tmdb', media_id: '1' }, season_number: 1, episode_number: 1 })).toMatchObject({ reason: 'no-date' });
		expect(playFromHistory({ media_type: 'movie', item: { source: 'mal', media_id: '9' }, played_at_local: '2026-01-01T00:00:00Z' })).toMatchObject({ reason: 'not-tmdb' });
	});

	it('falls back to the play’s own coordinates when Floppy gives no play id', () => {
		const p = playFromHistory({ media_type: 'episode', item: { source: 'tmdb', media_id: '7' }, season_number: 2, episode_number: 3, played_at_local: '2026-01-01T00:00:00Z' });
		expect(p).toMatchObject({ externalKey: 'floppy:tv:7:2:3:2026-01-01T00:00:00.000Z' });
	});
});
