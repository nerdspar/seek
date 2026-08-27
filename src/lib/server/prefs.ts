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
	| 'episodes_left'
	| 'your_rating';

export const APPEARANCES = ['system', 'light', 'dark'] as const;
export type Appearance = (typeof APPEARANCES)[number];

/** Ordered as shown in Settings. */
export const ACCENTS = ['violet', 'sky', 'teal', 'ember', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];

export type Prefs = {
	markDirection: MarkDirection;
	/** Sort is remembered per media type (§4.5). */
	sort: Record<string, SortKey>;
	defaultTab: 'watchlist' | 'upcoming' | 'discover' | 'profile';
	/** Season thumbnails on the show page. Off by default: Floppy returns the
	 *  show's poster for every season, so it is usually a column of identical
	 *  images — but some shows do have per-season art. */
	seasonArtwork: boolean;
	/** Track who you watched something with — the joint/solo tag (§11). Off
	 *  hides the chip, the watchlist filter and the sheet section; the tags
	 *  already on your data are left alone, so turning it back on restores it. */
	companyTracking: boolean;
	/** Confirm actions that would otherwise pass in silence — adding a title,
	 *  filling a season. Marking an episode always speaks, because undo lives
	 *  in that toast. */
	confirmToasts: boolean;
	/** Dark, light, or whatever the phone is set to. */
	appearance: Appearance;
	/** The gradient. Independent of appearance — each accent works on both. */
	accent: Accent;
	/** Services the household actually pays for (§6.3, §8). Empty means "all". */
	services: string[];
	/**
	 * Discover's mood chips, in display order (§6.2).
	 *
	 * Stored as labels rather than keyword ids: a label the user types resolves
	 * through TMDB's keyword search at query time, and the built-in labels have
	 * curated id sets that are better than a single lookup. Null means "use the
	 * built-in list", so shipping new defaults reaches anyone who has not edited
	 * theirs.
	 */
	moodPresets: string[] | null;
};

export const DEFAULTS: Prefs = {
	markDirection: 'rtl',
	sort: {},
	defaultTab: 'watchlist',
	seasonArtwork: false,
	companyTracking: true,
	confirmToasts: true,
	appearance: 'system',
	accent: 'violet',
	services: [],
	moodPresets: null
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
	episodes_left: { label: 'Episodes left', sort: 'time_left', direction: 'desc' },
	// Verified against a live instance: `score` orders by *your* rating, not the
	// community one, and unrated rows fall to the end.
	your_rating: { label: 'Your rating', sort: 'score', direction: 'desc' }
};

export const DEFAULT_SORT: SortKey = 'recently_watched';

const file = () => join(env.SEEK_DATA_DIR || '/data', 'preferences.json');

let cache: Prefs | null = null;

/* These two are written straight into a data attribute that CSS selects on, so
   an unrecognised value matches no rule at all and the page renders with no
   tokens — black text on a black background. Clamp on the way in and out. */
function clamp(p: Prefs): Prefs {
	return {
		...p,
		appearance: APPEARANCES.includes(p.appearance) ? p.appearance : DEFAULTS.appearance,
		accent: ACCENTS.includes(p.accent) ? p.accent : DEFAULTS.accent
	};
}

export async function getPrefs(): Promise<Prefs> {
	if (cache) return cache;
	try {
		const raw = await readFile(file(), 'utf8');
		const parsed = JSON.parse(raw) as Partial<Prefs>;
		cache = clamp({
			...DEFAULTS,
			...parsed,
			sort: { ...DEFAULTS.sort, ...(parsed.sort ?? {}) }
		});
	} catch {
		// Missing or unreadable file is the normal first-run case.
		cache = { ...DEFAULTS, sort: {}, services: [], moodPresets: null };
	}
	return cache;
}

/* Writes are serialised. Each one is a read-modify-write over the whole file, so
   two in flight together both read the same starting state and the second
   overwrites the first's change — and the loser is still handed a success
   response describing values that never reached disk. Two quick taps in Settings
   is enough to hit it. */
let writes: Promise<unknown> = Promise.resolve();

export function setPrefs(patch: Partial<Prefs>): Promise<Prefs> {
	const run = writes.then(
		() => write(patch),
		() => write(patch)
	);
	// Keep the chain alive even when a write rejects, or every later one is lost.
	writes = run.catch(() => {});
	return run;
}

async function write(patch: Partial<Prefs>): Promise<Prefs> {
	const current = await getPrefs();
	const next: Prefs = clamp({
		...current,
		...patch,
		sort: { ...current.sort, ...(patch.sort ?? {}) },
		// Replaced wholesale rather than merged — deselecting a service, or
		// reordering the chips, has to actually take effect.
		services: patch.services ?? current.services,
		moodPresets: patch.moodPresets !== undefined ? patch.moodPresets : current.moodPresets
	});

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
