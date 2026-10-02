import { describe, it, expect } from 'vitest';
import {
	episodeState,
	queuePercent,
	downloadingEpisodes,
	audioBadges,
	formatSize,
	isUsenet,
	historyEvent,
	timeAgo
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
	it('is missing when aired, not on disk, not queued', () => {
		expect(episodeState(ep({ id: 7 }), new Set([9]), true)).toBe('missing');
	});
	it('is unaired when not yet aired and not downloaded', () => {
		expect(episodeState(ep({ id: 7 }), new Set(), false)).toBe('unaired');
	});
	it('prefers have/downloading over unaired', () => {
		expect(episodeState(ep({ id: 7, hasFile: true }), new Set(), false)).toBe('have');
		expect(episodeState(ep({ id: 7 }), new Set([7]), false)).toBe('downloading');
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

describe('historyEvent', () => {
	it('labels and tones the common events', () => {
		expect(historyEvent('grabbed')).toEqual({ label: 'Grabbed', tone: 'neutral' });
		expect(historyEvent('downloadFolderImported')).toEqual({ label: 'Imported', tone: 'ok' });
		expect(historyEvent('downloadFailed')).toEqual({ label: 'Failed', tone: 'bad' });
		expect(historyEvent('episodeFileDeleted')).toEqual({ label: 'File deleted', tone: 'warn' });
	});
	it('humanises an unknown camelCase event rather than blanking', () => {
		expect(historyEvent('seriesScanSkipped')).toEqual({ label: 'Series Scan Skipped', tone: 'neutral' });
	});
});

describe('timeAgo', () => {
	const now = Date.parse('2026-10-01T12:00:00Z');
	it('uses compact buckets up to weeks', () => {
		expect(timeAgo('2026-10-01T11:59:30Z', now)).toBe('now');
		expect(timeAgo('2026-10-01T11:30:00Z', now)).toBe('30m');
		expect(timeAgo('2026-10-01T09:00:00Z', now)).toBe('3h');
		expect(timeAgo('2026-09-29T12:00:00Z', now)).toBe('2d');
		expect(timeAgo('2026-09-10T12:00:00Z', now)).toBe('3w');
	});
	it('reads a future date as soon, and a bad/empty one as blank', () => {
		expect(timeAgo('2026-10-01T12:05:00Z', now)).toBe('soon');
		expect(timeAgo(null, now)).toBe('');
		expect(timeAgo('not-a-date', now)).toBe('');
	});
});
