/**
 * Sonarr / Radarr integration (§ requests). Server-only — the API keys live in
 * env and never reach the browser, the same rule as the Floppy token.
 *
 * Seek indexes everything by TMDB id. Radarr takes a TMDB id directly; Sonarr is
 * TVDB-native, so a show is resolved through Sonarr's own lookup
 * (`series/lookup?term=tmdb:<id>`), which returns the fully-formed series object
 * — tvdbId, titleSlug, images, seasons — that the add POST then wants back with
 * a root folder and quality profile bolted on. Adding a hand-built object is how
 * you get a half-tracked series, so the lookup result is passed through intact.
 *
 * Verified shape notes:
 * - Both expose /api/v3/rootfolder and /api/v3/qualityprofile.
 * - Sonarr v3 requires a languageProfileId on add; v4 removed language profiles.
 *   So it is included only when /api/v3/languageprofile returns any — which makes
 *   the same code work against both without a version check.
 * - Already-in-library is answered from the full series/movie list (cached
 *   briefly), matched on tmdbId, which both carry on their library objects.
 */
import {
	SONARR_URL,
	SONARR_API_KEY,
	RADARR_URL,
	RADARR_API_KEY
} from './env';
import { TTLCache } from './cache';

export type Service = 'sonarr' | 'radarr';

export class ArrError extends Error {
	constructor(
		readonly service: Service,
		readonly status: number,
		readonly body: string
	) {
		super(`${service} → ${status}: ${body.slice(0, 300)}`);
		this.name = 'ArrError';
	}
}

/** Thrown when the request never reached the service (down / wrong URL). */
export class ArrUnreachable extends Error {
	constructor(
		readonly service: Service,
		readonly cause: unknown
	) {
		super(`${service} unreachable: ${cause}`);
		this.name = 'ArrUnreachable';
	}
}

const conf = (service: Service) =>
	service === 'sonarr'
		? { url: SONARR_URL(), key: SONARR_API_KEY() }
		: { url: RADARR_URL(), key: RADARR_API_KEY() };

export const sonarrConfigured = () => Boolean(SONARR_URL() && SONARR_API_KEY());
export const radarrConfigured = () => Boolean(RADARR_URL() && RADARR_API_KEY());
export const configured = (service: Service) =>
	service === 'sonarr' ? sonarrConfigured() : radarrConfigured();

type Req = {
	method?: 'GET' | 'POST' | 'DELETE';
	query?: Record<string, string | number | undefined>;
	body?: unknown;
	timeoutMs?: number;
};

async function arr<T = unknown>(service: Service, path: string, opts: Req = {}): Promise<T> {
	const { url, key } = conf(service);
	if (!url || !key) throw new ArrUnreachable(service, 'not configured');

	const { method = 'GET', query, body, timeoutMs = 15_000 } = opts;
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) qs.set(k, String(v));
	const full = `${url}/api/v3${path}${qs.toString() ? `?${qs}` : ''}`;

	let res: Response;
	try {
		res = await fetch(full, {
			method,
			headers: {
				'X-Api-Key': key,
				Accept: 'application/json',
				...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch (cause) {
		throw new ArrUnreachable(service, cause);
	}

	if (!res.ok) throw new ArrError(service, res.status, await res.text().catch(() => ''));
	if (res.status === 204) return undefined as T;
	const text = await res.text();
	return (text ? JSON.parse(text) : undefined) as T;
}

/* ── Options for the Settings picker ───────────────────────────────────────── */

export type RootFolder = { path: string; freeSpace: number | null };
export type QualityProfile = { id: number; name: string };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const arrList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export async function getRootFolders(service: Service): Promise<RootFolder[]> {
	const rows = await arr<unknown[]>(service, '/rootfolder');
	return arrList(rows)
		.map((r) => {
			const o = rec(r);
			return {
				path: typeof o.path === 'string' ? o.path : '',
				freeSpace: typeof o.freeSpace === 'number' ? o.freeSpace : null
			};
		})
		.filter((r) => r.path);
}

export async function getQualityProfiles(service: Service): Promise<QualityProfile[]> {
	const rows = await arr<unknown[]>(service, '/qualityprofile');
	return arrList(rows)
		.map((r) => {
			const o = rec(r);
			return { id: typeof o.id === 'number' ? o.id : -1, name: typeof o.name === 'string' ? o.name : '' };
		})
		.filter((p) => p.id >= 0 && p.name);
}

/** Sonarr v3 only. Empty on v4 (language profiles were removed there). */
async function getLanguageProfileId(): Promise<number | null> {
	try {
		const rows = await arr<unknown[]>('sonarr', '/languageprofile');
		const first = arrList(rows)[0];
		const id = rec(first).id;
		return typeof id === 'number' ? id : null;
	} catch {
		return null;
	}
}

export type ArrOptions = {
	configured: boolean;
	rootFolders: RootFolder[];
	profiles: QualityProfile[];
};

/** Everything the Settings picker needs for one service, or a not-configured
 *  marker. Never throws — a service that is down returns configured:true with
 *  empty lists so the UI can say "couldn't reach it" rather than vanish. */
export async function getOptions(service: Service): Promise<ArrOptions> {
	if (!configured(service)) return { configured: false, rootFolders: [], profiles: [] };
	try {
		const [rootFolders, profiles] = await Promise.all([
			getRootFolders(service),
			getQualityProfiles(service)
		]);
		return { configured: true, rootFolders, profiles };
	} catch {
		return { configured: true, rootFolders: [], profiles: [] };
	}
}

/* ── Already-in-library membership ─────────────────────────────────────────── */

/* Short TTL: the full list is a few hundred rows and this is read on every
   Discover/Search view. Dropped after an add so a freshly-added title shows as
   present immediately. */
const libraryCache = new TTLCache<Set<string>>(60 * 1000, 4);

async function libraryTmdbIds(service: Service): Promise<Set<string>> {
	const hit = libraryCache.get(service);
	if (hit) return hit;
	const path = service === 'sonarr' ? '/series' : '/movie';
	const rows = await arr<unknown[]>(service, path);
	const ids = new Set<string>();
	for (const r of arrList(rows)) {
		const tmdbId = rec(r).tmdbId;
		if (typeof tmdbId === 'number' && tmdbId > 0) ids.add(String(tmdbId));
	}
	libraryCache.set(service, ids);
	return ids;
}

export function dropLibraryCache(service: Service): void {
	libraryCache.delete(service);
}

/** tmdbIds already in each service's library, for marking browse rows. Missing
 *  or unreachable services just contribute an empty set. */
export async function libraryStatus(): Promise<{ sonarr: string[]; radarr: string[] }> {
	const [sonarr, radarr] = await Promise.all([
		sonarrConfigured() ? libraryTmdbIds('sonarr').catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
		radarrConfigured() ? libraryTmdbIds('radarr').catch(() => new Set<string>()) : Promise.resolve(new Set<string>())
	]);
	return { sonarr: [...sonarr], radarr: [...radarr] };
}

/* ── Adding ────────────────────────────────────────────────────────────────── */

export type AddOptions = {
	rootFolderPath: string;
	qualityProfileId: number;
	monitored?: boolean;
	/** Kick off a search immediately (start grabbing) rather than just monitor. */
	search?: boolean;
};

/** Look up a show/movie by TMDB id and return the service's own object for it,
 *  which is what the add POST wants back. Null if the service doesn't know it. */
async function lookup(service: Service, tmdbId: string): Promise<Record<string, unknown> | null> {
	if (service === 'sonarr') {
		const rows = await arr<unknown[]>('sonarr', '/series/lookup', { query: { term: `tmdb:${tmdbId}` } });
		const hit = arrList(rows)[0];
		return hit ? rec(hit) : null;
	}
	// Radarr resolves a single movie by tmdb id directly.
	const hit = await arr<unknown>('radarr', '/movie/lookup/tmdb', { query: { tmdbId } });
	const o = rec(hit);
	return o.tmdbId ? o : null;
}

export type AddResult = { ok: true; title: string; alreadyAdded?: boolean };

/**
 * Add a title to Sonarr/Radarr for monitoring. Idempotent-ish: a title already
 * in the library returns alreadyAdded rather than erroring, so a double-tap or a
 * stale row is harmless.
 */
export async function addTitle(
	service: Service,
	tmdbId: string,
	opts: AddOptions
): Promise<AddResult> {
	const found = await lookup(service, tmdbId);
	if (!found) throw new ArrError(service, 404, `${service} could not find TMDB id ${tmdbId}`);

	const title = typeof found.title === 'string' ? found.title : 'this title';
	// Already tracked: the lookup object carries a real id once it is in the
	// library. Report success rather than provoking a 400 on re-add.
	if (typeof found.id === 'number' && found.id > 0) {
		return { ok: true, title, alreadyAdded: true };
	}

	const monitored = opts.monitored ?? true;

	if (service === 'sonarr') {
		const languageProfileId = await getLanguageProfileId();
		const body: Record<string, unknown> = {
			...found,
			rootFolderPath: opts.rootFolderPath,
			qualityProfileId: opts.qualityProfileId,
			monitored,
			seasonFolder: true,
			addOptions: {
				monitor: 'all',
				searchForMissingEpisodes: Boolean(opts.search),
				searchForCutoffUnmetEpisodes: false
			}
		};
		if (languageProfileId !== null) body.languageProfileId = languageProfileId;
		await arr('sonarr', '/series', { method: 'POST', body, timeoutMs: 30_000 });
	} else {
		const body: Record<string, unknown> = {
			...found,
			rootFolderPath: opts.rootFolderPath,
			qualityProfileId: opts.qualityProfileId,
			monitored,
			minimumAvailability: 'released',
			addOptions: { searchForMovie: Boolean(opts.search) }
		};
		await arr('radarr', '/movie', { method: 'POST', body, timeoutMs: 30_000 });
	}

	dropLibraryCache(service);
	return { ok: true, title };
}
