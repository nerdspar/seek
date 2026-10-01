import { describe, it, expect } from 'vitest';
import {
	episodeState,
	queuePercent,
	downloadingEpisodes,
	audioBadges,
	formatSize,
	isUsenet
} from './arrClient';
import type { ArrEpisode, ArrFile, ArrQueueItem } from '$lib/server/arr';

const ep = (over: Partial<ArrEpisode>): ArrEpisode => ({
	id: 1,
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

describe('episodeState', () => {
	it('is unknown when the episode is not in Sonarr', () => {
		expect(episodeState(undefined, new Set())).toBe('unknown');
	});
	it('is have when the file is present, even if also (stale) in the queue', () => {
		expect(episodeState(ep({ id: 7, hasFile: true }), new Set([7]))).toBe('have');
	});
	it('is downloading when queued and no file yet', () => {
		expect(episodeState(ep({ id: 7, hasFile: false }), new Set([7]))).toBe('downloading');
	});
	it('is missing when neither on disk nor queued', () => {
		expect(episodeState(ep({ id: 7 }), new Set([9]))).toBe('missing');
	});
});

describe('queuePercent', () => {
	it('is 0 for an unsized or just-queued item (no NaN)', () => {
		expect(queuePercent({ size: 0, sizeleft: 0 })).toBe(0);
	});
	it('rounds the completed fraction', () => {
		expect(queuePercent({ size: 1000, sizeleft: 580 })).toBe(42);
		expect(queuePercent({ size: 1000, sizeleft: 0 })).toBe(100);
	});
	it('clamps out-of-range inputs', () => {
		expect(queuePercent({ size: 1000, sizeleft: 2000 })).toBe(0);
		expect(queuePercent({ size: 1000, sizeleft: -100 })).toBe(100);
	});
});

describe('downloadingEpisodes', () => {
	it('maps episode-bound queue items to their percent, ignoring the rest', () => {
		const q: ArrQueueItem[] = [
			{ id: 1, title: '', status: 'downloading', trackedState: null, size: 1000, sizeleft: 250, timeleft: null, errorMessage: null, seriesId: 1, movieId: null, seasonNumber: 2, episodeId: 23 },
			{ id: 2, title: '', status: 'downloading', trackedState: null, size: 0, sizeleft: 0, timeleft: null, errorMessage: null, seriesId: null, movieId: 9, seasonNumber: null, episodeId: null }
		];
		const m = downloadingEpisodes(q);
		expect(m.get(23)).toBe(75);
		expect(m.size).toBe(1);
	});
});

describe('audioBadges', () => {
	it('shortens known languages and preserves order (dub detection)', () => {
		const file = { mediaInfo: { audioLanguages: ['eng', 'jpn'] } } as ArrFile;
		expect(audioBadges(file)).toEqual(['EN', 'JA']);
	});
	it('upper-cases unknown codes and tolerates a fileless episode', () => {
		expect(audioBadges({ mediaInfo: { audioLanguages: ['tam'] } } as ArrFile)).toEqual(['TAM']);
		expect(audioBadges(null)).toEqual([]);
	});
});

describe('formatSize', () => {
	it('uses GB at/above 1GB and MB below', () => {
		expect(formatSize(6.2e9)).toBe('6.2 GB');
		expect(formatSize(820e6)).toBe('820 MB');
		expect(formatSize(0)).toBe('—');
	});
});

describe('isUsenet', () => {
	it('is true only for the usenet protocol', () => {
		expect(isUsenet({ protocol: 'usenet' })).toBe(true);
		expect(isUsenet({ protocol: 'torrent' })).toBe(false);
	});
});
