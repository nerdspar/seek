/**
 * Client-side Sonarr/Radarr state, loaded once and shared.
 *
 * Every browse surface (Discover, Search, the detail pages) wants to know two
 * things: is this service configured at all, and is this title already in its
 * library. Fetching that per row would be N requests; instead the whole
 * membership set is pulled once from /api/arr/status and every ArrButton reads
 * from here. Client-only — no-ops during SSR.
 */
type ArrState = {
	loaded: boolean;
	sonarr: { configured: boolean; ids: Set<string> };
	radarr: { configured: boolean; ids: Set<string> };
};

const browser = typeof window !== 'undefined';

const state = $state<ArrState>({
	loaded: false,
	sonarr: { configured: false, ids: new Set() },
	radarr: { configured: false, ids: new Set() }
});

let loading: Promise<void> | null = null;

/** Load membership + configured flags once. Safe to call from every button. */
export function loadArrStatus(force = false): Promise<void> {
	if (!browser) return Promise.resolve();
	if (loading && !force) return loading;
	if (state.loaded && !force) return Promise.resolve();
	// Warm the add options too, so opening the sheet is instant.
	void loadArrOptions();
	loading = fetch('/api/arr/status')
		.then((r) => (r.ok ? r.json() : null))
		.then((body) => {
			if (body) {
				state.sonarr = { configured: !!body.sonarr?.configured, ids: new Set(body.sonarr?.ids ?? []) };
				state.radarr = { configured: !!body.radarr?.configured, ids: new Set(body.radarr?.ids ?? []) };
			}
			state.loaded = true;
		})
		.catch(() => {
			state.loaded = true; // Don't wedge the UI on a failed probe.
		})
		.finally(() => {
			loading = null;
		});
	return loading;
}

export const serviceKey = (mediaType: string): 'sonarr' | 'radarr' =>
	mediaType === 'movie' ? 'radarr' : 'sonarr';

const svc = (mediaType: string) => (mediaType === 'movie' ? state.radarr : state.sonarr);

/* ── Add options (folders / profiles / tags / saved defaults) ──────────────── */

/** Local copy of the pref shape so the client need not import from $lib/server. */
export type ArrPref = { rootFolderPath: string; qualityProfileId: number; monitor?: string; tags?: string[] };
export type ClientOpts = {
	configured: boolean;
	rootFolders: { path: string; freeSpace: number | null }[];
	profiles: { id: number; name: string }[];
	tags: { id: number; label: string }[];
	default: ArrPref | null;
};
const EMPTY: ClientOpts = { configured: false, rootFolders: [], profiles: [], tags: [], default: null };

const opts = $state<{ loaded: boolean; sonarr: ClientOpts; radarr: ClientOpts }>({
	loaded: false,
	sonarr: { ...EMPTY },
	radarr: { ...EMPTY }
});
let optsLoading: Promise<void> | null = null;

/** Load folders/profiles/tags/defaults once, for the add sheet. */
export function loadArrOptions(force = false): Promise<void> {
	if (!browser) return Promise.resolve();
	if (optsLoading && !force) return optsLoading;
	if (opts.loaded && !force) return Promise.resolve();
	optsLoading = fetch('/api/arr/options')
		.then((r) => (r.ok ? r.json() : null))
		.then((b) => {
			if (b) {
				opts.sonarr = b.sonarr ?? { ...EMPTY };
				opts.radarr = b.radarr ?? { ...EMPTY };
			}
			opts.loaded = true;
		})
		.catch(() => {
			opts.loaded = true;
		})
		.finally(() => {
			optsLoading = null;
		});
	return optsLoading;
}

export const arrOptionsLoaded = () => opts.loaded;
export function arrOptionsFor(mediaType: string): ClientOpts {
	return opts[serviceKey(mediaType)];
}

/** Static monitor enums per service (Sonarr episodes / Radarr movie). */
export const MONITOR_OPTIONS: Record<'sonarr' | 'radarr', { value: string; label: string }[]> = {
	sonarr: [
		{ value: 'all', label: 'All Episodes' },
		{ value: 'future', label: 'Future Episodes' },
		{ value: 'missing', label: 'Missing Episodes' },
		{ value: 'existing', label: 'Existing Episodes' },
		{ value: 'recent', label: 'Recent Episodes' },
		{ value: 'pilot', label: 'Pilot Episode' },
		{ value: 'firstSeason', label: 'First Season' },
		{ value: 'lastSeason', label: 'Last Season' },
		{ value: 'none', label: 'None' }
	],
	radarr: [
		{ value: 'movieOnly', label: 'Movie Only' },
		{ value: 'movieAndCollection', label: 'Movie and Collection' },
		{ value: 'none', label: 'None' }
	]
};
export const DEFAULT_MONITOR: Record<'sonarr' | 'radarr', string> = {
	sonarr: 'all',
	radarr: 'movieOnly'
};
export const monitorOptions = (mediaType: string) => MONITOR_OPTIONS[serviceKey(mediaType)];
export const defaultMonitor = (mediaType: string) => DEFAULT_MONITOR[serviceKey(mediaType)];

/** Whether the service that would handle this media type is set up at all. */
export function arrConfigured(mediaType: string): boolean {
	return svc(mediaType).configured;
}

export function arrServiceName(mediaType: string): 'Sonarr' | 'Radarr' {
	return mediaType === 'movie' ? 'Radarr' : 'Sonarr';
}

/** Whether this title is already in the relevant service's library. */
export function inArr(mediaType: string, tmdbId: string): boolean {
	return svc(mediaType).ids.has(String(tmdbId));
}

/** Optimistically record an add so the tick appears immediately. Reassigns the
 *  set rather than mutating it, so the change is reactive. */
export function markInArr(mediaType: string, tmdbId: string): void {
	const s = svc(mediaType);
	s.ids = new Set(s.ids).add(String(tmdbId));
}
