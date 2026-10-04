/**
 * Upcoming (§5). The backend fetches and parses the iCal feed on a schedule,
 * caches it, and serves JSON — the feed URL contains a credential and must never
 * reach the browser.
 *
 * The feed carries no artwork and its UID is a Floppy row id rather than a TMDB
 * id, so posters and show links are recovered by matching the event title
 * against the library. Measured 163/163 once RFC 5545 escaping is undone.
 */
import { floppy } from './floppy';
import { calendarToken, scopeId, NotLinkedError } from './userctx';
import { FLOPPY_URL } from './env';
import { parseIcal, type IcalEvent } from './ical';
import { memo } from './memo';
import type { UpcomingItem } from '$lib/types';


type Cached = { at: number; items: UpcomingItem[] };
/* Per user — each person's calendar feed is their own library's schedule. */
const cache = new Map<number, Cached>();
const inflight = new Map<number, Promise<UpcomingItem[]>>();

/** §5.1 says every 30–60 min is plenty; release schedules move slowly. */
const TTL_MS = 45 * 60 * 1000;

async function fetchFeed(): Promise<IcalEvent[]> {
	const token = calendarToken();
	if (!token) throw new NotLinkedError('floppy');

	const params = new URLSearchParams();
	for (const t of ['tv', 'season', 'movie', 'anime']) params.append('media_types', t);

	const res = await fetch(`${FLOPPY_URL()}/calendar/download/${token}?${params}`, {
		signal: AbortSignal.timeout(20_000)
	});
	if (!res.ok) throw new Error(`Calendar feed returned ${res.status}`);
	return parseIcal(await res.text());
}

type ListResponse = { results?: { item?: Record<string, unknown> }[] };

/**
 * Title → poster and ids, for attaching artwork to feed events.
 *
 * This is the expensive part of Upcoming by a wide margin: Floppy needs ~3.6s
 * and 1.9 MB per page of 100, so indexing a 370-item library costs ~13s. It is
 * cached hard and warmed at boot (see warmCaches) precisely so no tap ever pays
 * for it. The data barely moves — titles and posters of things already tracked.
 */
function libraryIndex() {
	return memo('upcoming:index', 6 * 60 * 60 * 1000, buildLibraryIndex);
}

type IndexEntry = {
	poster: string | null;
	mediaId: string;
	source: string;
	/** Which detail route the row links to — this index spans both libraries. */
	mediaType: 'tv' | 'movie';
};

async function buildLibraryIndex(): Promise<Map<string, IndexEntry>> {
	const index = new Map<string, IndexEntry>();

	for (const mediaType of ['tv', 'movie'] as const) {
		let offset = 0;
		for (;;) {
			const res = await floppy<ListResponse>(`/api/v1/media/${mediaType}/`, {
				// ~3.6s and 1.9 MB per page from Floppy; the default is too tight.
				query: { status: ['all'], limit: 100, offset },
				timeoutMs: 60_000
			});
			const rows = res.results ?? [];
			for (const r of rows) {
				const item = r.item ?? {};
				const title = typeof item.title === 'string' ? item.title.toLowerCase() : '';
				const mediaId = String(item.media_id ?? '');
				if (!title || !mediaId || index.has(title)) continue;
				index.set(title, {
					poster: typeof item.image === 'string' ? item.image : null,
					mediaId,
					source: String(item.source ?? 'tmdb'),
					mediaType
				});
			}
			offset += 100;
			if (rows.length < 100 || offset > 1000) break;
		}
	}

	return index;
}

async function build(): Promise<UpcomingItem[]> {
	const [events, index] = await Promise.all([fetchFeed(), libraryIndex()]);
	const now = Date.now();

	// Keep a 30-day backward window so Upcoming can also answer "what aired
	// recently" — scroll up past Today. Anything older belongs in the diary. (No
	// extra Floppy cost: the whole feed is fetched either way and sliced here.)
	const PAST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
	return events
		.filter((e) => new Date(e.start).getTime() >= now - PAST_WINDOW_MS)
		.map((e): UpcomingItem => {
			const hit = index.get(e.title.toLowerCase());
			return {
				title: e.title,
				season: e.season,
				episode: e.episode,
				start: e.start,
				hasTime: e.hasTime,
				poster: hit?.poster ?? null,
				mediaId: hit?.mediaId ?? null,
				source: hit?.source ?? null,
				/* A feed event with SxEy is an episode whatever the index says; only
				   an unnumbered one can be a film. */
				mediaType: e.episode === null ? (hit?.mediaType ?? 'tv') : 'tv'
			};
		});
}

/**
 * Warms the slow caches in the background at startup, so the first person to
 * open a tab after a container restart doesn't absorb the cold cost. Failures
 * are ignored: this is an optimisation, and every caller still works without it.
 */
export async function warmCaches(): Promise<void> {
	// getUpcoming needs the index, so building it first means one pass, not two
	// competing ones.
	await libraryIndex().catch(() => {});
	await getUpcoming().catch(() => {});
}

/** Drop the current user's cached calendar (after they relink their account). */
export function forgetUpcoming(): void {
	cache.delete(scopeId());
}

/** Cached read. Concurrent callers share one in-flight refresh. */
export async function getUpcoming(force = false): Promise<UpcomingItem[]> {
	const who = scopeId();
	const cached = cache.get(who);
	if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.items;
	const running = inflight.get(who);
	if (running) return running;

	const next = build()
		.then((items) => {
			cache.set(who, { at: Date.now(), items });
			return items;
		})
		.catch((err) => {
			// Serve stale rather than nothing — a missed refresh should not empty
			// the tab.
			const stale = cache.get(who);
			if (stale) return stale.items;
			throw err;
		})
		.finally(() => {
			inflight.delete(who);
		});

	inflight.set(who, next);
	return next;
}
