/**
 * Pure helpers for the download-management UI. Kept out of the components so the
 * fiddly bits — episode state, queue correlation, language display — are unit
 * tested rather than eyeballed. Types come from the server module as type-only
 * imports (erased at build, so no server code is bundled), which keeps the client
 * and server shapes from drifting.
 */
import type { ArrEpisode, ArrFile, ArrQueueItem, ArrRelease } from '$lib/server/arr';

export type DlState = 'have' | 'downloading' | 'unaired' | 'missing' | 'unknown';

/** The download state of one episode, given the set of episode ids currently in a
 *  download queue and whether the episode has aired yet. `unknown` is "not in
 *  Sonarr" — the row shows no indicator. Priority: have > downloading > unaired >
 *  missing, so a future episode reads as pending rather than a gap to fill. */
export function episodeState(
	ep: ArrEpisode | undefined,
	downloading: Set<number>,
	aired = true
): DlState {
	if (!ep) return 'unknown';
	if (ep.hasFile) return 'have';
	if (downloading.has(ep.id)) return 'downloading';
	if (!aired) return 'unaired';
	return 'missing';
}

/** Percent complete for a queue item (0–100, rounded), guarding the empty-size
 *  case so a just-queued item reads 0 rather than NaN. */
export function queuePercent(q: { size: number; sizeleft: number }): number {
	if (!q.size || q.size <= 0) return 0;
	return Math.max(0, Math.min(100, Math.round(((q.size - q.sizeleft) / q.size) * 100)));
}

/** episodeId → percent, for the queue items that belong to episodes. Lets the
 *  season page show a live % on a downloading row. */
export function downloadingEpisodes(queue: ArrQueueItem[]): Map<number, number> {
	const m = new Map<number, number>();
	for (const q of queue) {
		if (q.episodeId != null) m.set(q.episodeId, queuePercent(q));
	}
	return m;
}

/** Audio-language codes of a downloaded file (the dub signal), upper-cased for
 *  display: `["eng","jpn"]` → `["EN","JA"]` via a small common map, else the
 *  three-letter code upper-cased. */
const LANG_SHORT: Record<string, string> = {
	eng: 'EN',
	jpn: 'JA',
	spa: 'ES',
	fre: 'FR',
	fra: 'FR',
	ger: 'DE',
	deu: 'DE',
	ita: 'IT',
	por: 'PT',
	kor: 'KO',
	chi: 'ZH',
	zho: 'ZH',
	rus: 'RU'
};

export function audioBadges(file: ArrFile | null | undefined): string[] {
	const langs = file?.mediaInfo?.audioLanguages ?? [];
	return langs.map((l) => LANG_SHORT[l] ?? l.toUpperCase());
}

/** Human size, e.g. 6.2 GB / 820 MB. */
export function formatSize(bytes: number): string {
	if (!bytes || bytes <= 0) return '—';
	const gb = bytes / 1e9;
	if (gb >= 1) return `${gb.toFixed(1)} GB`;
	return `${Math.round(bytes / 1e6)} MB`;
}

/** Usenet releases have no seeders; torrent ones do. Decides which stat line a
 *  release row shows so the sheet reads right for a Usenet-only stack. */
export function isUsenet(r: Pick<ArrRelease, 'protocol'>): boolean {
	return r.protocol === 'usenet';
}

export type ReleaseSort = 'weight' | 'age' | 'quality' | 'size' | 'score';

export const RELEASE_SORTS: { key: ReleaseSort; label: string }[] = [
	{ key: 'weight', label: 'Best match' },
	{ key: 'quality', label: 'Quality' },
	{ key: 'size', label: 'File size' },
	{ key: 'age', label: 'Age' },
	{ key: 'score', label: 'Custom score' }
];

export type ReleaseArrange = {
	sort: ReleaseSort;
	dir: 'asc' | 'desc';
	onlyApproved: boolean;
	quality: string | null;
	indexer: string | null;
};

/** Filter then sort interactive-search releases, client-side. `weight` preserves
 *  the server's own ranking (best first) via the original index, so "Best match"
 *  really is Sonarr/Radarr's order. Pure, for the unit test. */
export function arrangeReleases(releases: ArrRelease[], o: ReleaseArrange): ArrRelease[] {
	const withIdx = releases.map((r, i) => ({ r, i }));
	const filtered = withIdx.filter(
		({ r }) =>
			(!o.onlyApproved || !r.rejected) &&
			(!o.quality || r.quality === o.quality) &&
			(!o.indexer || r.indexer === o.indexer)
	);
	const key = ({ r, i }: { r: ArrRelease; i: number }): number => {
		switch (o.sort) {
			case 'age':
				return r.age;
			case 'quality':
				return r.resolution ?? 0;
			case 'size':
				return r.size;
			case 'score':
				return r.customFormatScore ?? 0;
			default:
				return i;
		}
	};
	filtered.sort((a, b) => key(a) - key(b) || a.i - b.i);
	if (o.dir === 'desc') filtered.reverse();
	return filtered.map(({ r }) => r);
}

export const distinctQualities = (releases: ArrRelease[]): string[] =>
	[...new Set(releases.map((r) => r.quality).filter((q): q is string => !!q))];

export const distinctIndexers = (releases: ArrRelease[]): string[] =>
	[...new Set(releases.map((r) => r.indexer).filter((i): i is string => !!i))];

export type HistoryTone = 'ok' | 'warn' | 'bad' | 'neutral';

/** Map a Sonarr/Radarr history eventType to a short label + a tone for colour.
 *  Unknown events fall back to a humanised camelCase split rather than a blank. */
export function historyEvent(eventType: string): { label: string; tone: HistoryTone } {
	switch (eventType) {
		case 'grabbed':
			return { label: 'Grabbed', tone: 'neutral' };
		case 'downloadFolderImported':
		case 'movieFileImported':
		case 'seriesFolderImported':
			return { label: 'Imported', tone: 'ok' };
		case 'downloadFailed':
			return { label: 'Failed', tone: 'bad' };
		case 'downloadIgnored':
			return { label: 'Ignored', tone: 'warn' };
		case 'episodeFileDeleted':
		case 'movieFileDeleted':
			return { label: 'File deleted', tone: 'warn' };
		case 'episodeFileRenamed':
		case 'movieFileRenamed':
			return { label: 'Renamed', tone: 'neutral' };
		default:
			return {
				label: eventType.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim(),
				tone: 'neutral'
			};
	}
}

/** Compact "time ago" for a history/air date: "now", "5m", "3h", "2d", "4w",
 *  then a short date. `now` is injectable for the test. */
export function timeAgo(iso: string | null, now: number = Date.now()): string {
	if (!iso) return '';
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return '';
	const sec = Math.round((now - then) / 1000);
	if (sec < 0) return 'soon';
	if (sec < 60) return 'now';
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h`;
	const day = Math.floor(hr / 24);
	if (day < 7) return `${day}d`;
	const wk = Math.floor(day / 7);
	if (wk < 5) return `${wk}w`;
	return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
