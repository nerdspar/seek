import { describe, it, expect, vi, afterEach } from 'vitest';
import { tvmazeEpisodes } from './sources';

afterEach(() => vi.unstubAllGlobals());

describe('tvmazeEpisodes', () => {
	it('keeps real air times and drops the noon-UTC placeholder TVmaze gives streaming drops', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(
					JSON.stringify([
						{ season: 52, number: 2, airtime: '23:30', airdate: '2026-10-03', airstamp: '2026-10-04T03:30:00+00:00' },
						{ season: 1, number: 1, airtime: '', airdate: '2026-10-09', airstamp: '2026-10-09T12:00:00+00:00' }
					])
				)
			)
		);
		expect((await tvmazeEpisodes(1)).map((e) => e.airstamp)).toEqual(['2026-10-04T03:30:00+00:00', null]);
	});
});
