/**
 * Pure helpers for the download-management UI. Kept out of the components so the
 * fiddly bits — episode state, queue correlation, language display — are unit
 * tested rather than eyeballed. Types come from the server module as type-only
 * imports (erased at build, so no server code is bundled), which keeps the client
 * and server shapes from drifting.
 */
import type { ArrEpisode, ArrFile, ArrQueueItem, ArrRelease } from '$lib/server/arr';

export type DlState = 'have' | 'downloading' | 'missing' | 'unknown';

/** The download state of one episode, given the set of episode ids currently in a
 *  download queue. `unknown` is "not in Sonarr" — the row shows no affordance. */
export function episodeState(ep: ArrEpisode | undefined, downloading: Set<number>): DlState {
	if (!ep) return 'unknown';
	if (ep.hasFile) return 'have';
	if (downloading.has(ep.id)) return 'downloading';
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
