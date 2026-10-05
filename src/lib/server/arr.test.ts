import { describe, it, expect } from 'vitest';
import { parseLangList, sortReleases, importLabel, mapServerTitle, notOnYourList, type ArrRelease } from './arr';

describe('parseLangList', () => {
	it('splits a slash list and dedupes', () => {
		expect(parseLangList('eng/jpn')).toEqual(['eng', 'jpn']);
		expect(parseLangList('eng/eng')).toEqual(['eng']);
	});
	it('drops blanks and the "und" placeholder', () => {
		expect(parseLangList('eng//und')).toEqual(['eng']);
		expect(parseLangList('')).toEqual([]);
	});
	it('is empty for a non-string', () => {
		expect(parseLangList(null)).toEqual([]);
		expect(parseLangList(42)).toEqual([]);
	});
});

const rel = (over: Partial<ArrRelease>): ArrRelease => ({
	guid: 'g',
	indexerId: 1,
	indexer: 'x',
	title: 't',
	size: 0,
	age: 0,
	protocol: 'usenet',
	seeders: null,
	leechers: null,
	grabs: null,
	quality: null,
	resolution: null,
	languages: [],
	customFormatScore: 0,
	flags: [],
	rejections: [],
	rejected: false,
	approved: true,
	fullSeason: false,
	seasonNumber: null,
	...over
});

describe('importLabel', () => {
	it('is mappable with a series + episode, and labels it', () => {
		const file = {
			series: { id: 170, title: 'Ranking of Kings' },
			seasonNumber: 1,
			episodes: [{ id: 22087, episodeNumber: 4 }]
		};
		expect(importLabel('sonarr', file)).toEqual({ title: 'Ranking of Kings · S01E04', mappable: true });
	});
	it('is not mappable when Sonarr found no episodes', () => {
		const file = { series: { id: 170, title: 'Ranking of Kings' }, seasonNumber: 1, episodes: [], relativePath: 'x.mkv' };
		expect(importLabel('sonarr', file).mappable).toBe(false);
	});
	it('maps a Radarr movie by its movie id', () => {
		expect(importLabel('radarr', { movie: { id: 20, title: 'Jurassic Park' } })).toEqual({
			title: 'Jurassic Park',
			mappable: true
		});
	});
	it('is not mappable when Radarr could not match a movie', () => {
		expect(importLabel('radarr', { movie: {}, relativePath: 'y.mkv' }).mappable).toBe(false);
	});
});

describe('sortReleases', () => {
	it('puts accepted releases before rejected ones', () => {
		const out = sortReleases([
			rel({ guid: 'bad', rejected: true, customFormatScore: 500 }),
			rel({ guid: 'ok', rejected: false, customFormatScore: 0 })
		]);
		expect(out.map((r) => r.guid)).toEqual(['ok', 'bad']);
	});
	it('orders by custom-format score within the same acceptance bucket', () => {
		const out = sortReleases([
			rel({ guid: 'low', customFormatScore: 10 }),
			rel({ guid: 'high', customFormatScore: 135 })
		]);
		expect(out.map((r) => r.guid)).toEqual(['high', 'low']);
	});
	it('does not mutate its input', () => {
		const input = [rel({ guid: 'a', rejected: true }), rel({ guid: 'b' })];
		const copy = [...input];
		sortReleases(input);
		expect(input).toEqual(copy);
	});
});

describe('on the server, not on your list', () => {
	const series = (tmdbId: number | null, title: string, added: string, extra: Record<string, unknown> = {}) => ({
		tmdbId,
		title,
		added,
		year: 2024,
		images: [
			{ coverType: 'banner', remoteUrl: 'https://img/banner.jpg' },
			{ coverType: 'poster', remoteUrl: `https://img/${title}.jpg` }
		],
		...extra
	});

	it('turns a Sonarr series into a TMDB-keyed tile with its poster', () => {
		expect(mapServerTitle('sonarr', series(1399, 'Got', '2026-01-01T00:00:00Z'))).toEqual({
			mediaType: 'tv',
			source: 'tmdb',
			mediaId: '1399',
			title: 'Got',
			poster: 'https://img/Got.jpg',
			year: 2024,
			addedAt: '2026-01-01T00:00:00Z'
		});
		expect(mapServerTitle('radarr', series(603, 'Matrix', 'x'))?.mediaType).toBe('movie');
		const tmdb = { ...series(603, 'Matrix', 'x'), images: [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/original/abc.jpg' }] };
		expect(mapServerTitle('radarr', tmdb)?.poster).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
	});

	it('skips rows with no TMDB id (nothing to match your list on)', () => {
		expect(mapServerTitle('sonarr', series(null, 'Orphan', 'x'))).toBeNull();
		expect(mapServerTitle('sonarr', series(0, 'Orphan', 'x'))).toBeNull();
	});

	it('keeps only what you are not tracking, newest to the server first', () => {
		const titles = [
			series(1, 'Old', '2025-01-01T00:00:00Z'),
			series(2, 'Tracked', '2026-06-01T00:00:00Z'),
			series(3, 'New', '2026-09-01T00:00:00Z')
		].map((s) => mapServerTitle('sonarr', s)!);
		expect(notOnYourList(titles, new Set(['2'])).map((t) => t.title)).toEqual(['New', 'Old']);
	});
});
