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

const svc = (mediaType: string) => (mediaType === 'movie' ? state.radarr : state.sonarr);

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
