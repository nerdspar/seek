import { describe, it, expect } from 'vitest';
import { parseLangList, sortReleases, type ArrRelease } from './arr';

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
