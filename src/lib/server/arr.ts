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
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
	query?: Record<string, string | number | boolean | undefined>;
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

export type Tag = { id: number; label: string };

export async function getTags(service: Service): Promise<Tag[]> {
	const rows = await arr<unknown[]>(service, '/tag');
	return arrList(rows)
		.map((r) => {
			const o = rec(r);
			return { id: typeof o.id === 'number' ? o.id : -1, label: typeof o.label === 'string' ? o.label : '' };
		})
		.filter((t) => t.id >= 0 && t.label);
}

/** Resolve tag labels to ids, creating any that don't exist yet. */
async function ensureTags(service: Service, labels: string[]): Promise<number[]> {
	const wanted = labels.map((l) => l.trim()).filter(Boolean);
	if (!wanted.length) return [];
	const existing = await getTags(service).catch(() => [] as Tag[]);
	const byLabel = new Map(existing.map((t) => [t.label.toLowerCase(), t.id]));
	const ids: number[] = [];
	for (const label of wanted) {
		let id = byLabel.get(label.toLowerCase());
		if (id === undefined) {
			const created = rec(await arr(service, '/tag', { method: 'POST', body: { label } }));
			if (typeof created.id === 'number') {
				id = created.id;
				byLabel.set(label.toLowerCase(), id);
			}
		}
		if (id !== undefined && !ids.includes(id)) ids.push(id);
	}
	return ids;
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
	tags: Tag[];
};

/** Everything the Settings picker and add sheet need for one service, or a
 *  not-configured marker. Never throws — a service that is down returns
 *  configured:true with empty lists so the UI can say "couldn't reach it"
 *  rather than vanish. */
export async function getOptions(service: Service): Promise<ArrOptions> {
	if (!configured(service)) return { configured: false, rootFolders: [], profiles: [], tags: [] };
	try {
		const [rootFolders, profiles, tags] = await Promise.all([
			getRootFolders(service),
			getQualityProfiles(service),
			getTags(service).catch(() => [] as Tag[])
		]);
		return { configured: true, rootFolders, profiles, tags };
	} catch {
		return { configured: true, rootFolders: [], profiles: [], tags: [] };
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
	/** Service-specific monitor enum. Sonarr: all/future/missing/existing/recent/
	 *  pilot/firstSeason/lastSeason/none. Radarr: movieOnly/movieAndCollection/none.
	 *  'none' means add unmonitored. */
	monitor?: string;
	/** Tag labels; resolved to ids (created if new) before the add. */
	tags?: string[];
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

	const tags = await ensureTags(service, opts.tags ?? []);

	if (service === 'sonarr') {
		const monitor = opts.monitor ?? 'all';
		const languageProfileId = await getLanguageProfileId();
		const body: Record<string, unknown> = {
			...found,
			rootFolderPath: opts.rootFolderPath,
			qualityProfileId: opts.qualityProfileId,
			monitored: monitor !== 'none',
			seasonFolder: true,
			tags,
			addOptions: {
				monitor,
				searchForMissingEpisodes: Boolean(opts.search),
				searchForCutoffUnmetEpisodes: false
			}
		};
		if (languageProfileId !== null) body.languageProfileId = languageProfileId;
		await arr('sonarr', '/series', { method: 'POST', body, timeoutMs: 30_000 });
	} else {
		const monitor = opts.monitor ?? 'movieOnly';
		const body: Record<string, unknown> = {
			...found,
			rootFolderPath: opts.rootFolderPath,
			qualityProfileId: opts.qualityProfileId,
			monitored: monitor !== 'none',
			minimumAvailability: 'released',
			tags,
			addOptions: { monitor, searchForMovie: Boolean(opts.search) }
		};
		await arr('radarr', '/movie', { method: 'POST', body, timeoutMs: 30_000 });
	}

	dropLibraryCache(service);
	return { ok: true, title };
}

/* ── Management: detail, edit, monitor, search, releases, queue, files ──────────
 *
 * Shapes below were probed against a live Sonarr 4.0 / Radarr 6.4 (see the plan
 * doc). Series and movie both carry tmdbId, so the title match reuses the proven
 * tmdbId path rather than needing TVDB. Episodes line up to Floppy's rows by
 * (season, episode) number — Floppy exposes no per-episode TVDB id. Every mapper
 * is defensive: a field the API drops becomes null/empty rather than a throw.
 */

const n = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const b = (v: unknown): boolean => v === true;

/** Split Sonarr's slash-joined language/subtitle lists ("eng/jpn") into a deduped
 *  list, dropping the "und"/blank noise. Exported for the unit test. */
export function parseLangList(v: unknown): string[] {
	if (typeof v !== 'string') return [];
	const out: string[] = [];
	for (const part of v.split('/')) {
		const t = part.trim().toLowerCase();
		if (t && t !== 'und' && !out.includes(t)) out.push(t);
	}
	return out;
}

export type ArrMediaInfo = {
	audioLanguages: string[];
	subtitles: string[];
	audioChannels: number | null;
	audioCodec: string | null;
	videoCodec: string | null;
	videoDynamicRange: string | null;
	resolution: string | null;
};

export type ArrFile = {
	id: number;
	quality: string | null;
	size: number;
	languages: string[];
	customFormatScore: number | null;
	relativePath: string | null;
	mediaInfo: ArrMediaInfo | null;
};

export type ArrSeason = {
	seasonNumber: number;
	monitored: boolean;
	episodeFileCount: number;
	episodeCount: number;
	totalEpisodeCount: number;
};

export type ArrSeries = {
	id: number;
	tmdbId: number;
	tvdbId: number | null;
	title: string;
	monitored: boolean;
	qualityProfileId: number;
	rootFolderPath: string | null;
	seriesType: string;
	seasonFolder: boolean;
	tags: number[];
	seasons: ArrSeason[];
	episodeFileCount: number;
	totalEpisodeCount: number;
};

export type ArrMovie = {
	id: number;
	tmdbId: number;
	title: string;
	monitored: boolean;
	qualityProfileId: number;
	rootFolderPath: string | null;
	minimumAvailability: string;
	tags: number[];
	hasFile: boolean;
	movieFileId: number | null;
	file: ArrFile | null;
};

export type ArrEpisode = {
	id: number;
	seasonNumber: number;
	episodeNumber: number;
	title: string;
	hasFile: boolean;
	monitored: boolean;
	episodeFileId: number | null;
	airDateUtc: string | null;
	file: ArrFile | null;
};

export type ArrRelease = {
	guid: string;
	indexerId: number;
	indexer: string;
	title: string;
	size: number;
	age: number;
	protocol: string;
	seeders: number | null;
	leechers: number | null;
	grabs: number | null;
	quality: string | null;
	resolution: number | null;
	languages: string[];
	customFormatScore: number | null;
	flags: string[];
	rejections: string[];
	rejected: boolean;
	approved: boolean;
	fullSeason: boolean;
	seasonNumber: number | null;
};

export type ArrQueueItem = {
	id: number;
	title: string;
	status: string;
	trackedState: string | null;
	size: number;
	sizeleft: number;
	timeleft: string | null;
	errorMessage: string | null;
	seriesId: number | null;
	movieId: number | null;
	seasonNumber: number | null;
	episodeId: number | null;
	/* Enriched for the Activity queue view (left optional so the lightweight
	   per-episode % correlation on the detail pages doesn't need them). */
	service?: Service;
	name?: string;
	indexer?: string | null;
	protocol?: string | null;
	warning?: string | null;
};

export type ArrHistoryItem = {
	id: number;
	service: Service;
	eventType: string;
	date: string | null;
	name: string;
	sourceTitle: string;
	quality: string | null;
	seriesId: number | null;
	episodeId: number | null;
	movieId: number | null;
};

export type ArrWantedItem = {
	service: Service;
	name: string;
	airDate: string | null;
	episodeId: number | null;
	movieId: number | null;
	tmdbId: number | null;
	seasonNumber: number | null;
	episodeNumber: number | null;
};

function mapMediaInfo(v: unknown): ArrMediaInfo | null {
	if (!v || typeof v !== 'object') return null;
	const o = rec(v);
	return {
		audioLanguages: parseLangList(o.audioLanguages),
		subtitles: parseLangList(o.subtitles),
		audioChannels: n(o.audioChannels),
		audioCodec: s(o.audioCodec),
		videoCodec: s(o.videoCodec),
		videoDynamicRange: s(o.videoDynamicRangeType) ?? s(o.videoDynamicRange),
		resolution: s(o.resolution)
	};
}

function mapFile(v: unknown): ArrFile | null {
	if (!v || typeof v !== 'object') return null;
	const o = rec(v);
	const id = n(o.id);
	if (id === null) return null;
	const quality = rec(rec(o.quality).quality);
	return {
		id,
		quality: s(quality.name),
		size: n(o.size) ?? 0,
		languages: arrList(o.languages)
			.map((l) => s(rec(l).name))
			.filter((x): x is string => x !== null),
		customFormatScore: n(o.customFormatScore),
		relativePath: s(o.relativePath),
		mediaInfo: mapMediaInfo(o.mediaInfo)
	};
}

function mapSeries(o: Record<string, unknown>): ArrSeries {
	const stats = rec(o.statistics);
	return {
		id: n(o.id) ?? 0,
		tmdbId: n(o.tmdbId) ?? 0,
		tvdbId: n(o.tvdbId),
		title: s(o.title) ?? 'Untitled',
		monitored: b(o.monitored),
		qualityProfileId: n(o.qualityProfileId) ?? -1,
		rootFolderPath: s(o.rootFolderPath),
		seriesType: s(o.seriesType) ?? 'standard',
		seasonFolder: o.seasonFolder !== false,
		tags: arrList(o.tags)
			.map((t) => n(t))
			.filter((x): x is number => x !== null),
		seasons: arrList(o.seasons)
			.map((entry): ArrSeason | null => {
				const se = rec(entry);
				const num = n(se.seasonNumber);
				if (num === null) return null;
				const st = rec(se.statistics);
				return {
					seasonNumber: num,
					monitored: b(se.monitored),
					episodeFileCount: n(st.episodeFileCount) ?? 0,
					episodeCount: n(st.episodeCount) ?? 0,
					totalEpisodeCount: n(st.totalEpisodeCount) ?? 0
				};
			})
			.filter((x): x is ArrSeason => x !== null),
		episodeFileCount: n(stats.episodeFileCount) ?? 0,
		totalEpisodeCount: n(stats.totalEpisodeCount) ?? 0
	};
}

function mapMovie(o: Record<string, unknown>): ArrMovie {
	return {
		id: n(o.id) ?? 0,
		tmdbId: n(o.tmdbId) ?? 0,
		title: s(o.title) ?? 'Untitled',
		monitored: b(o.monitored),
		qualityProfileId: n(o.qualityProfileId) ?? -1,
		rootFolderPath: s(o.rootFolderPath),
		minimumAvailability: s(o.minimumAvailability) ?? 'released',
		tags: arrList(o.tags)
			.map((t) => n(t))
			.filter((x): x is number => x !== null),
		hasFile: b(o.hasFile),
		movieFileId: n(o.movieFileId),
		file: mapFile(o.movieFile)
	};
}

function mapRelease(o: Record<string, unknown>): ArrRelease | null {
	const guid = s(o.guid);
	const indexerId = n(o.indexerId);
	if (guid === null || indexerId === null) return null;
	const quality = rec(rec(o.quality).quality);
	const flagsRaw = o.indexerFlags;
	const flags = Array.isArray(flagsRaw)
		? flagsRaw.map((f) => s(f)).filter((x): x is string => x !== null)
		: [];
	return {
		guid,
		indexerId,
		indexer: s(o.indexer) ?? 'Unknown',
		title: s(o.title) ?? '',
		size: n(o.size) ?? 0,
		age: n(o.age) ?? 0,
		protocol: s(o.protocol) ?? 'unknown',
		seeders: n(o.seeders),
		leechers: n(o.leechers),
		grabs: n(o.grabs),
		quality: s(quality.name),
		resolution: n(quality.resolution),
		languages: arrList(o.languages)
			.map((l) => s(rec(l).name))
			.filter((x): x is string => x !== null),
		customFormatScore: n(o.customFormatScore),
		flags,
		rejections: arrList(o.rejections)
			.map((r) => s(r))
			.filter((x): x is string => x !== null),
		rejected: b(o.rejected),
		approved: b(o.approved),
		fullSeason: b(o.fullSeason),
		seasonNumber: n(o.seasonNumber)
	};
}

/** Sort releases the way a human scans them: accepted first, then best
 *  custom-format score, then Sonarr's own release weight (lower = better).
 *  Exported pure for the unit test. */
export function sortReleases(releases: ArrRelease[]): ArrRelease[] {
	return [...releases].sort((a, c) => {
		if (a.rejected !== c.rejected) return a.rejected ? 1 : -1;
		const sa = a.customFormatScore ?? 0;
		const sc = c.customFormatScore ?? 0;
		if (sa !== sc) return sc - sa;
		return 0;
	});
}

/* Detail is read often (open a show, its seasons, back and forth) and is only
   mutated through this module, so a short TTL with explicit drops on write keeps
   it snappy without going stale. */
const detailCache = new TTLCache<unknown>(30 * 1000, 200);
const dkey = (service: Service, kind: string, id: string | number) => `${service}:${kind}:${id}`;

function dropDetail(service: Service, tmdbId: number | string): void {
	detailCache.delete(dkey(service, 'series', tmdbId));
	detailCache.delete(dkey(service, 'movie', tmdbId));
}

/** The raw Sonarr series object for a TMDB id (full, PUT-able), or null. */
async function rawSeries(tmdbId: string): Promise<Record<string, unknown> | null> {
	const rows = await arr<unknown[]>('sonarr', '/series');
	const hit = arrList(rows).find((r) => String(rec(r).tmdbId) === String(tmdbId));
	return hit ? rec(hit) : null;
}

async function rawMovie(tmdbId: string): Promise<Record<string, unknown> | null> {
	const rows = await arr<unknown[]>('radarr', '/movie');
	const hit = arrList(rows).find((r) => String(rec(r).tmdbId) === String(tmdbId));
	return hit ? rec(hit) : null;
}

/** Series summary for the show page's Downloads strip + season rows. Null when the
 *  show isn't in Sonarr. */
export async function getSeries(tmdbId: string): Promise<ArrSeries | null> {
	if (!sonarrConfigured()) return null;
	const key = dkey('sonarr', 'series', tmdbId);
	const cached = detailCache.get(key) as ArrSeries | null | undefined;
	if (cached !== undefined) return cached;
	const raw = await rawSeries(tmdbId);
	const mapped = raw ? mapSeries(raw) : null;
	detailCache.set(key, mapped);
	return mapped;
}

/** Movie summary + its file for the movie page. Null when not in Radarr. */
export async function getMovie(tmdbId: string): Promise<ArrMovie | null> {
	if (!radarrConfigured()) return null;
	const key = dkey('radarr', 'movie', tmdbId);
	const cached = detailCache.get(key) as ArrMovie | null | undefined;
	if (cached !== undefined) return cached;
	const raw = await rawMovie(tmdbId);
	const mapped = raw ? mapMovie(raw) : null;
	detailCache.set(key, mapped);
	return mapped;
}

/** Episodes for one Sonarr season, joined to their files (so audio languages and
 *  quality are present on the ones you have). Keyed by episode number for the
 *  season page to merge onto Floppy's rows. */
export async function getSeasonEpisodes(seriesId: number, seasonNumber?: number): Promise<ArrEpisode[]> {
	const [eps, files] = await Promise.all([
		arr<unknown[]>('sonarr', '/episode', { query: { seriesId, seasonNumber } }),
		arr<unknown[]>('sonarr', '/episodefile', { query: { seriesId } }).catch(() => [] as unknown[])
	]);
	const fileById = new Map<number, ArrFile>();
	for (const f of arrList(files)) {
		const mapped = mapFile(f);
		if (mapped) fileById.set(mapped.id, mapped);
	}
	return arrList(eps)
		.map((entry): ArrEpisode | null => {
			const e = rec(entry);
			const seasonNum = n(e.seasonNumber);
			const episodeNum = n(e.episodeNumber);
			const id = n(e.id);
			if (seasonNum === null || episodeNum === null || id === null) return null;
			const fileId = n(e.episodeFileId);
			return {
				id,
				seasonNumber: seasonNum,
				episodeNumber: episodeNum,
				title: s(e.title) ?? `Episode ${episodeNum}`,
				hasFile: b(e.hasFile),
				monitored: b(e.monitored),
				episodeFileId: fileId && fileId > 0 ? fileId : null,
				airDateUtc: s(e.airDateUtc),
				file: fileId && fileId > 0 ? (fileById.get(fileId) ?? null) : null
			};
		})
		.filter((x): x is ArrEpisode => x !== null)
		.sort((a, c) => a.episodeNumber - c.episodeNumber);
}

/* ── Edit settings ─────────────────────────────────────────────────────────── */

export type SeriesEdit = {
	monitored?: boolean;
	qualityProfileId?: number;
	rootFolderPath?: string;
	seriesType?: string;
	seasonFolder?: boolean;
	/** Tag labels; resolved to ids (created if new). */
	tags?: string[];
};

export type MovieEdit = {
	monitored?: boolean;
	qualityProfileId?: number;
	rootFolderPath?: string;
	minimumAvailability?: string;
	tags?: string[];
};

/** PUT a series back with the given fields changed. Fetches the current full
 *  object so unspecified fields are preserved exactly (a partial PUT half-tracks
 *  a series). */
export async function editSeries(tmdbId: string, edit: SeriesEdit): Promise<ArrSeries> {
	const raw = await rawSeries(tmdbId);
	if (!raw) throw new ArrError('sonarr', 404, `TMDB ${tmdbId} not in Sonarr`);
	if (edit.monitored !== undefined) raw.monitored = edit.monitored;
	if (edit.qualityProfileId !== undefined) raw.qualityProfileId = edit.qualityProfileId;
	if (edit.rootFolderPath !== undefined) raw.rootFolderPath = edit.rootFolderPath;
	if (edit.seriesType !== undefined) raw.seriesType = edit.seriesType;
	if (edit.seasonFolder !== undefined) raw.seasonFolder = edit.seasonFolder;
	if (edit.tags !== undefined) raw.tags = await ensureTags('sonarr', edit.tags);
	const updated = rec(await arr('sonarr', `/series/${n(raw.id)}`, { method: 'PUT', body: raw, timeoutMs: 30_000 }));
	dropDetail('sonarr', tmdbId);
	return mapSeries(Object.keys(updated).length ? updated : raw);
}

export async function editMovie(tmdbId: string, edit: MovieEdit): Promise<ArrMovie> {
	const raw = await rawMovie(tmdbId);
	if (!raw) throw new ArrError('radarr', 404, `TMDB ${tmdbId} not in Radarr`);
	if (edit.monitored !== undefined) raw.monitored = edit.monitored;
	if (edit.qualityProfileId !== undefined) raw.qualityProfileId = edit.qualityProfileId;
	if (edit.rootFolderPath !== undefined) raw.rootFolderPath = edit.rootFolderPath;
	if (edit.minimumAvailability !== undefined) raw.minimumAvailability = edit.minimumAvailability;
	if (edit.tags !== undefined) raw.tags = await ensureTags('radarr', edit.tags);
	const updated = rec(await arr('radarr', `/movie/${n(raw.id)}`, { method: 'PUT', body: raw, timeoutMs: 30_000 }));
	dropDetail('radarr', tmdbId);
	return mapMovie(Object.keys(updated).length ? updated : raw);
}

/** Monitor / unmonitor a whole season (flips the flag on the series object and
 *  PUTs it, which is how Sonarr tracks season monitoring). */
export async function setSeasonMonitored(tmdbId: string, seasonNumber: number, monitored: boolean): Promise<void> {
	const raw = await rawSeries(tmdbId);
	if (!raw) throw new ArrError('sonarr', 404, `TMDB ${tmdbId} not in Sonarr`);
	const seasons = arrList(raw.seasons).map((se) => {
		const o = rec(se);
		if (n(o.seasonNumber) === seasonNumber) o.monitored = monitored;
		return o;
	});
	raw.seasons = seasons;
	await arr('sonarr', `/series/${n(raw.id)}`, { method: 'PUT', body: raw, timeoutMs: 30_000 });
	dropDetail('sonarr', tmdbId);
}

/** Monitor / unmonitor specific episodes by Sonarr episode id. */
export async function setEpisodesMonitored(episodeIds: number[], monitored: boolean): Promise<void> {
	if (!episodeIds.length) return;
	await arr('sonarr', '/episode/monitor', { method: 'PUT', body: { episodeIds, monitored } });
}

/* ── Search (automatic) ────────────────────────────────────────────────────── */

export type SearchTarget =
	| { kind: 'series'; seriesId: number }
	| { kind: 'season'; seriesId: number; seasonNumber: number }
	| { kind: 'episodes'; episodeIds: number[] }
	| { kind: 'movie'; movieId: number };

/** Kick off an automatic search. Returns the command id so the caller can poll,
 *  though the UI mostly fires and forgets (the queue shows the result). */
export async function runSearch(target: SearchTarget): Promise<number | null> {
	let service: Service = 'sonarr';
	let body: Record<string, unknown>;
	switch (target.kind) {
		case 'series':
			body = { name: 'SeriesSearch', seriesId: target.seriesId };
			break;
		case 'season':
			body = { name: 'SeasonSearch', seriesId: target.seriesId, seasonNumber: target.seasonNumber };
			break;
		case 'episodes':
			body = { name: 'EpisodeSearch', episodeIds: target.episodeIds };
			break;
		case 'movie':
			service = 'radarr';
			body = { name: 'MoviesSearch', movieIds: [target.movieId] };
			break;
	}
	const res = rec(await arr(service, '/command', { method: 'POST', body }));
	return n(res.id);
}

/* ── Interactive search (manual releases) ──────────────────────────────────── */

export type ReleaseQuery =
	| { service: 'sonarr'; episodeId: number }
	| { service: 'sonarr'; seriesId: number; seasonNumber: number }
	| { service: 'radarr'; movieId: number };

/** Fetch candidate releases for an episode / season / movie. Slow (hits indexers,
 *  5–30s), so callers give it a long timeout and a spinner. Sorted for scanning. */
export async function getReleases(q: ReleaseQuery): Promise<ArrRelease[]> {
	const query: Record<string, string | number> =
		q.service === 'radarr'
			? { movieId: q.movieId }
			: 'episodeId' in q
				? { episodeId: q.episodeId }
				: { seriesId: q.seriesId, seasonNumber: q.seasonNumber };
	const rows = await arr<unknown[]>(q.service, '/release', { query, timeoutMs: 90_000 });
	return sortReleases(
		arrList(rows)
			.map((r) => mapRelease(rec(r)))
			.filter((r): r is ArrRelease => r !== null)
	);
}

/** Grab a chosen release — the one real side-effect of interactive search. */
export async function grabRelease(service: Service, guid: string, indexerId: number): Promise<void> {
	await arr(service, '/release', { method: 'POST', body: { guid, indexerId }, timeoutMs: 30_000 });
}

/* ── Queue (what's downloading now) ────────────────────────────────────────── */

/** A padded two-digit SxxEyy label, for queue/history names. */
const sxe = (season: number | null, episode: number | null): string => {
	if (season === null || episode === null) return '';
	const pad = (x: number) => String(x).padStart(2, '0');
	return `S${pad(season)}E${pad(episode)}`;
};

/** First human warning on a queue item (import blocked, no files, etc.). */
function queueWarning(o: Record<string, unknown>): string | null {
	const err = s(o.errorMessage);
	if (err) return err;
	for (const m of arrList(o.statusMessages)) {
		const msgs = arrList(rec(m).messages)
			.map((x) => s(x))
			.filter((x): x is string => x !== null);
		if (msgs.length) return msgs[0];
		const title = s(rec(m).title);
		if (title) return title;
	}
	return null;
}

export async function getQueue(service: Service): Promise<ArrQueueItem[]> {
	const res = rec(
		await arr(service, '/queue', {
			query: {
				pageSize: 100,
				includeEpisode: service === 'sonarr',
				includeSeries: service === 'sonarr',
				includeMovie: service === 'radarr'
			}
		})
	);
	return arrList(res.records)
		.map((entry): ArrQueueItem | null => {
			const o = rec(entry);
			const id = n(o.id);
			if (id === null) return null;
			const seasonNumber = n(o.seasonNumber);
			const episodeNumber = n(rec(o.episode).episodeNumber);
			const name =
				service === 'sonarr'
					? [s(rec(o.series).title), sxe(seasonNumber, episodeNumber), s(rec(o.episode).title)]
							.filter(Boolean)
							.join(' · ')
					: (s(rec(o.movie).title) ?? s(o.title) ?? '');
			return {
				id,
				title: s(o.title) ?? '',
				status: s(o.status) ?? 'unknown',
				trackedState: s(o.trackedDownloadState),
				size: n(o.size) ?? 0,
				sizeleft: n(o.sizeleft) ?? 0,
				timeleft: s(o.timeleft),
				errorMessage: s(o.errorMessage),
				seriesId: n(o.seriesId),
				movieId: n(o.movieId),
				seasonNumber,
				episodeId: n(o.episodeId),
				service,
				name: name || (s(o.title) ?? ''),
				indexer: s(o.indexer),
				protocol: s(o.protocol),
				warning: queueWarning(o)
			};
		})
		.filter((x): x is ArrQueueItem => x !== null);
}

/** Remove a queue item. `removeFromClient` also deletes the download in the
 *  client; `blocklist` bans the release so a re-search won't pick it again. */
export async function removeQueueItem(
	service: Service,
	id: number,
	opts: { removeFromClient?: boolean; blocklist?: boolean } = {}
): Promise<void> {
	await arr(service, `/queue/${id}`, {
		method: 'DELETE',
		query: {
			removeFromClient: opts.removeFromClient ?? true,
			blocklist: opts.blocklist ?? false
		}
	});
}

/** Recent history, newest first — grabs, imports, failures, deletions. */
export async function getHistory(service: Service, page = 1, pageSize = 40): Promise<ArrHistoryItem[]> {
	const res = rec(
		await arr(service, '/history', {
			query: {
				page,
				pageSize,
				sortKey: 'date',
				sortDirection: 'descending',
				includeEpisode: service === 'sonarr',
				includeSeries: service === 'sonarr',
				includeMovie: service === 'radarr'
			}
		})
	);
	return arrList(res.records)
		.map((entry): ArrHistoryItem | null => {
			const o = rec(entry);
			const id = n(o.id);
			if (id === null) return null;
			const episodeNumber = n(rec(o.episode).episodeNumber);
			const seasonNumber = n(rec(o.episode).seasonNumber);
			const name =
				service === 'sonarr'
					? [s(rec(o.series).title), sxe(seasonNumber, episodeNumber)].filter(Boolean).join(' · ')
					: (s(rec(o.movie).title) ?? s(o.sourceTitle) ?? '');
			return {
				id,
				service,
				eventType: s(o.eventType) ?? 'unknown',
				date: s(o.date),
				name: name || (s(o.sourceTitle) ?? ''),
				sourceTitle: s(o.sourceTitle) ?? '',
				quality: s(rec(rec(o.quality).quality).name),
				seriesId: n(o.seriesId),
				episodeId: n(o.episodeId),
				movieId: n(o.movieId)
			};
		})
		.filter((x): x is ArrHistoryItem => x !== null);
}

/** Monitored-but-missing items (or cutoff-unmet). Sonarr returns episodes,
 *  Radarr returns movies; both map to a unified row with search targeting. */
export async function getWanted(
	service: Service,
	kind: 'missing' | 'cutoff' = 'missing',
	page = 1,
	pageSize = 40
): Promise<ArrWantedItem[]> {
	const res = rec(
		await arr(service, `/wanted/${kind}`, {
			query: {
				page,
				pageSize,
				sortKey: service === 'sonarr' ? 'episodes.airDateUtc' : 'movieMetadata.sortTitle',
				sortDirection: service === 'sonarr' ? 'descending' : 'ascending',
				includeSeries: service === 'sonarr'
			}
		})
	);
	return arrList(res.records)
		.map((entry): ArrWantedItem | null => {
			const o = rec(entry);
			if (service === 'sonarr') {
				const episodeId = n(o.id);
				if (episodeId === null) return null;
				const seasonNumber = n(o.seasonNumber);
				const episodeNumber = n(o.episodeNumber);
				return {
					service,
					name: [s(rec(o.series).title), sxe(seasonNumber, episodeNumber), s(o.title)]
						.filter(Boolean)
						.join(' · '),
					airDate: s(o.airDateUtc),
					episodeId,
					movieId: null,
					tmdbId: null,
					seasonNumber,
					episodeNumber
				};
			}
			const movieId = n(o.id);
			if (movieId === null) return null;
			const year = n(o.year);
			return {
				service,
				name: [s(o.title), year ? `(${year})` : null].filter(Boolean).join(' '),
				airDate: s(o.digitalRelease) ?? s(o.physicalRelease),
				episodeId: null,
				movieId,
				tmdbId: n(o.tmdbId),
				seasonNumber: null,
				episodeNumber: null
			};
		})
		.filter((x): x is ArrWantedItem => x !== null);
}

/** Search every monitored-missing item on a service (the "search all" button). */
export async function searchAllMissing(service: Service): Promise<void> {
	const name = service === 'sonarr' ? 'MissingEpisodeSearch' : 'MissingMoviesSearch';
	await arr(service, '/command', { method: 'POST', body: { name } });
}

/* ── Delete a downloaded file ──────────────────────────────────────────────── */

export async function deleteFile(service: Service, fileId: number): Promise<void> {
	const path = service === 'sonarr' ? `/episodefile/${fileId}` : `/moviefile/${fileId}`;
	await arr(service, path, { method: 'DELETE' });
}

/** Drop the detail cache for a title after a mutation the caller made elsewhere
 *  (e.g. a grab that changes file state once imported). */
export function dropDetailCache(service: Service, tmdbId: string | number): void {
	dropDetail(service, tmdbId);
}
