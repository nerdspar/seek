/**
 * Seek's own preferences (§8). Stored as one small JSON file in /data — the
 * only thing Seek persists. Watch state belongs to Floppy and never lands here.
 *
 * Server-side rather than localStorage because these affect the *server* render:
 * a default sort kept in the browser would mean the first paint shows one order
 * and then reshuffles after hydration.
 */
import { env } from '$env/dynamic/private';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type MarkDirection = 'rtl' | 'ltr';

export type SortKey =
	| 'recently_watched'
	| 'newest_episode'
	| 'oldest_episode'
	| 'alphabetical'
	| 'total_episodes'
	| 'episodes_left';

export type Prefs = {
	markDirection: MarkDirection;
	/** Sort is remembered per media type (§4.5). */
	sort: Record<string, SortKey>;
	defaultTab: 'watchlist' | 'upcoming' | 'discover' | 'profile';
	/** Season thumbnails on the show page. Off by default: Floppy returns the
	 *  show's poster for every season, so it is usually a column of identical
	 *  images — but some shows do have per-season art. */
	seasonArtwork: boolean;
	/** §10 ships one theme, but the token sets are swappable from day one. */
	theme: 'midnight';
	/** Services the household actually pays for (§6.3, §8). Empty means "all". */
	services: string[];
};

export const DEFAULTS: Prefs = {
	markDirection: 'rtl',
	sort: {},
	defaultTab: 'watchlist',
	seasonArtwork: false,
	theme: 'midnight',
	services: []
};

/** Maps Seek's labels to Floppy's closed sort enum. */
export const SORTS: Record<SortKey, { label: string; sort: string; direction: 'asc' | 'desc' }> = {
	recently_watched: { label: 'Recently watched', sort: 'updated', direction: 'desc' },
	newest_episode: { label: 'Newest episode', sort: 'next_episode_air_date', direction: 'desc' },
	oldest_episode: { label: 'Oldest episode', sort: 'next_episode_air_date', direction: 'asc' },
	alphabetical: { label: 'Alphabetical', sort: 'title', direction: 'asc' },
	// Floppy has no episode-count sort; `runtime` is total runtime, which for TV
	// orders longest-show-first and is the closest thing it exposes.
	total_episodes: { label: 'Total episodes', sort: 'runtime', direction: 'desc' },
	// `time_left` is minutes remaining rather than a literal episode count, but it
	// is the only "how much is left" ordering Floppy offers.
	episodes_left: { label: 'Episodes left', sort: 'time_left', direction: 'desc' }
};

export const DEFAULT_SORT: SortKey = 'recently_watched';

const file = () => join(env.SEEK_DATA_DIR || '/data', 'preferences.json');

let cache: Prefs | null = null;

export async function getPrefs(): Promise<Prefs> {
	if (cache) return cache;
	try {
		const raw = await readFile(file(), 'utf8');
		const parsed = JSON.parse(raw) as Partial<Prefs>;
		cache = {
			...DEFAULTS,
			...parsed,
			sort: { ...DEFAULTS.sort, ...(parsed.sort ?? {}) }
		};
	} catch {
		// Missing or unreadable file is the normal first-run case.
		cache = { ...DEFAULTS, sort: {}, services: [] };
	}
	return cache;
}

export async function setPrefs(patch: Partial<Prefs>): Promise<Prefs> {
	const current = await getPrefs();
	const next: Prefs = {
		...current,
		...patch,
		sort: { ...current.sort, ...(patch.sort ?? {}) },
		// Replaced wholesale rather than merged — deselecting a service has to
		// actually remove it.
		services: patch.services ?? current.services
	};

	const path = file();
	try {
		await mkdir(dirname(path), { recursive: true });
		// Write-then-rename so a crash mid-write cannot truncate the file.
		const tmp = `${path}.tmp`;
		await writeFile(tmp, JSON.stringify(next, null, 2), 'utf8');
		await rename(tmp, path);
	} catch (err) {
		// Preferences are a convenience; an unwritable /data must not break the
		// app. Keep the change in memory for this process and carry on.
		console.warn('[seek] could not persist preferences:', err);
	}

	cache = next;
	return next;
}

export const sortFor = (prefs: Prefs, mediaType: string): SortKey =>
	prefs.sort[mediaType] ?? DEFAULT_SORT;
