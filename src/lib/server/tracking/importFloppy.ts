/**
 * Catching up from Floppy, run as one person (own-tracking plan). Seek is the
 * record; this only adds what reached Floppy alone — Jellyfin marks sent to
 * Floppy's webhook before you point Jellyfin at Seek. Read-only toward Floppy,
 * add-only toward Seek, safe to repeat.
 *
 * Floppy rebuilds a person's whole history for every page request (~9.5s) and
 * caps pages at 200, newest first, so a catch-up reads only back to `since`
 * (one page, usually); without it, the whole history (~11 minutes).
 */
import { floppy } from '../floppy';
import { currentUser } from '../userctx';
import { ensureTitle } from '../catalog/store';
import { isReview, playFromHistory, trackedFromList, type MediaType, type PlayRow, type Review, type TrackedRow } from './importMap';
import { addImportedPlays, addTracked, checkEpisodes, floppyBackedPlayCount, recordRun, replaceReviews, type ImportSummary } from './store';

const PAGE = 200;
type Page = { results?: unknown[]; pagination?: { total?: number; next?: string | null } };

async function allPages(path: string, query: Record<string, string>, enough: (page: unknown[]) => boolean = () => false): Promise<{ rows: unknown[]; total: number }> {
	const rows: unknown[] = [];
	let total = 0;
	for (let offset = 0; ; offset += PAGE) {
		const page = await floppy<Page>(path, { query: { ...query, limit: String(PAGE), offset: String(offset) }, timeoutMs: 120_000 });
		const got = page.results ?? [];
		if (offset === 0) total = page.pagination?.total ?? 0;
		rows.push(...got);
		if (got.length < PAGE || !page.pagination?.next || enough(got)) break;
	}
	return { rows, total };
}

export async function copyFromFloppy(since?: string): Promise<ImportSummary> {
	const user = currentUser();
	if (!user) throw new Error('copyFromFloppy needs a person');
	const reviews: Review[] = [];
	const from = since ? Date.parse(since) : -Infinity;
	const summary: ImportSummary = {
		ranAt: new Date().toISOString(),
		tracked: { tv: 0, movie: 0 },
		plays: { tv: { floppy: 0, seek: 0, skipped: 0 }, movie: { floppy: 0, seek: 0, skipped: 0 } },
		added: 0,
		removed: 0,
		review: 0,
		pendingCatalog: 0,
		matches: false
	};

	for (const mediaType of ['tv', 'movie'] as MediaType[]) {
		// What they track, with status, rating and when it was added.
		const list = await allPages(`/api/v1/media/${mediaType}/`, { status: 'all', progress: 'all' });
		const tracked: TrackedRow[] = [];
		for (const raw of list.rows) {
			const t = trackedFromList(mediaType, raw);
			if (isReview(t)) reviews.push(t);
			else tracked.push(t);
		}
		summary.added += addTracked(user.id, mediaType, tracked);
		for (const t of tracked) ensureTitle(mediaType, t.tmdbId);
		summary.tracked[mediaType] = tracked.length;

		// Every play, newest first.
		const before = (raw: unknown) => {
			const p = playFromHistory(raw);
			return p !== null && !isReview(p) && Date.parse(p.watchedAt) < from;
		};
		const history = await allPages('/api/v1/history/', { flat: '1', media_type: mediaType }, (page) => before(page[page.length - 1]));
		const plays: PlayRow[] = [];
		let skipped = 0;
		for (const raw of history.rows) {
			const p = playFromHistory(raw);
			if (p !== null && !isReview(p) && Date.parse(p.watchedAt) < from) continue;
			if (p === null) skipped++;
			else if (isReview(p)) (reviews.push(p), skipped++);
			else plays.push(p);
		}
		summary.added += addImportedPlays(user.id, mediaType, plays).added;
		summary.plays[mediaType] = { floppy: history.total, seek: floppyBackedPlayCount(user.id, mediaType), skipped };
	}

	const check = checkEpisodes(user.id);
	reviews.push(...check.missing);
	replaceReviews(user.id, reviews);
	summary.review = reviews.length;
	summary.pendingCatalog = check.pending;
	// Only a full read can be checked against Floppy's totals.
	summary.matches =
		since === undefined &&
		reviews.length === 0 &&
		(['tv', 'movie'] as MediaType[]).every((m) => summary.plays[m].seek + summary.plays[m].skipped === summary.plays[m].floppy);
	recordRun(user.id, summary);
	return summary;
}
