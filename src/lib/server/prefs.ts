/**
 * Seek's own preferences (§8), per person: each account's prefs live on its row
 * in the user store (users.ts). Watch state belongs to Floppy and never lands here.
 *
 * Server-side rather than localStorage because these affect the *server* render:
 * a default sort kept in the browser would mean the first paint shows one order
 * and then reshuffles after hydration.
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { scopeId, currentUser } from './userctx';
import { getPrefsJson, setPrefsJson, getOwner } from './users';
import { dataDir } from './db';

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
	/** Send a daily push listing today's episodes (§ notifications). Off until
	 *  a device subscribes and the user opts in. */
	notifyDigest: boolean;
	/** Local hour (0–23) the digest goes out. */
	digestHour: number;
	/** Push each show as it airs — at its real time, or local midnight for an
	 *  all-day streaming drop. Independent of the daily digest. */
	notifyAtTime: boolean;
	/** Where Sonarr/Radarr files new adds and at what quality (§ requests). Null
	 *  until picked in Settings; the connection itself is in Settings → Services. */
	sonarr: ArrPref | null;
	radarr: ArrPref | null;
	/** Show the download-management layer (edit settings, per-episode/season
	 *  search, interactive grabs, file delete/replace) on top of the basic add
	 *  button. On by default when a service is configured; off hides all of it so
	 *  a household member who only tracks watches never sees it. Per person — a
	 *  member starts with it off. */
	arrManage: boolean;
	/** What Seek is for, per person: shows, movies and books can each be turned
	 *  off, and everything about them leaves Watchlist, Discover, Upcoming and
	 *  Profile. At least one stays on (clamped). Books also needs a books
	 *  backend configured (docs/books-plan.md). */
	showsEnabled: boolean;
	moviesEnabled: boolean;
	booksEnabled: boolean;
};

/** Default add settings for one *arr. These pre-fill the add sheet, where any of
 *  them can be overridden per title. `monitor` is a service-specific enum
 *  (Sonarr: all/future/…; Radarr: movieOnly/…); `tags` are tag labels, resolved
 *  to ids (created if new) at add time. Both are optional for back-compat with
 *  prefs written before they existed. */
export type ArrPref = {
	rootFolderPath: string;
	qualityProfileId: number;
	monitor?: string;
	tags?: string[];
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
	moodPresets: null,
	notifyDigest: false,
	digestHour: 8,
	notifyAtTime: false,
	sonarr: null,
	radarr: null,
	arrManage: true,
	showsEnabled: true,
	moviesEnabled: true,
	booksEnabled: true
};

/* When someone joins the household their prefs start from the defaults, except
   for these, which describe the household rather than the person: the *arr add
   defaults, the streaming services you pay for, and whether you track who you
   watched with. Download management starts hidden for a member — it's the
   owner's tooling, and they can turn it on. */
const HOUSEHOLD_FIELDS = ['sonarr', 'radarr', 'services', 'companyTracking'] as const;

export function memberStartingPrefs(owner: Prefs): Prefs {
	const start: Prefs = { ...DEFAULTS, sort: {}, services: [], moodPresets: null, arrManage: false };
	for (const k of HOUSEHOLD_FIELDS) (start as Record<string, unknown>)[k] = owner[k];
	return start;
}

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

/* The pre-accounts store. Still read for work outside any user context, and as
   the owner's starting point the first time they sign in. */
const file = () => join(dataDir(), 'preferences.json');

/* Per user (userctx scope id); 0 is the legacy file. */
const cache = new Map<number, Prefs>();

/* These two are written straight into a data attribute that CSS selects on, so
   an unrecognised value matches no rule at all and the page renders with no
   tokens — black text on a black background. Clamp on the way in and out. */
function clamp(p: Prefs): Prefs {
	// Turning everything off would leave an empty app; shows come back on.
	const noneOn = !p.showsEnabled && !p.moviesEnabled && !p.booksEnabled;
	return {
		...p,
		showsEnabled: noneOn ? true : p.showsEnabled !== false,
		moviesEnabled: p.moviesEnabled !== false,
		appearance: APPEARANCES.includes(p.appearance) ? p.appearance : DEFAULTS.appearance,
		accent: ACCENTS.includes(p.accent) ? p.accent : DEFAULTS.accent,
		digestHour:
			Number.isInteger(p.digestHour) && p.digestHour >= 0 && p.digestHour <= 23
				? p.digestHour
				: DEFAULTS.digestHour
	};
}

function fromJson(raw: string): Prefs {
	const parsed = JSON.parse(raw) as Partial<Prefs>;
	return clamp({
		...DEFAULTS,
		...parsed,
		sort: { ...DEFAULTS.sort, ...(parsed.sort ?? {}) }
	});
}

async function readLegacy(): Promise<Prefs> {
	try {
		return fromJson(await readFile(file(), 'utf8'));
	} catch {
		// Missing or unreadable file is the normal first-run case.
		return { ...DEFAULTS, sort: {}, services: [], moodPresets: null };
	}
}

/** The signed-in person's preferences (the legacy file outside any user). */
export async function getPrefs(): Promise<Prefs> {
	const who = scopeId();
	const hit = cache.get(who);
	if (hit) return hit;

	let prefs: Prefs;
	const stored = who ? getPrefsJson(who) : null;
	if (who === 0) {
		prefs = await readLegacy();
	} else if (stored) {
		try {
			prefs = fromJson(stored);
		} catch {
			prefs = { ...DEFAULTS, sort: {}, services: [], moodPresets: null };
		}
	} else {
		// First time this person's prefs are read: the owner inherits everything
		// set before accounts existed; a member starts fresh with the household
		// fields copied from the owner.
		const me = currentUser();
		const legacy = await readLegacy();
		if (me?.role === 'owner') {
			prefs = legacy;
		} else {
			const owner = getOwner();
			const ownerJson = owner ? getPrefsJson(owner.id) : null;
			prefs = memberStartingPrefs(ownerJson ? fromJson(ownerJson) : legacy);
		}
		setPrefsJson(who, JSON.stringify(prefs));
	}
	cache.set(who, prefs);
	return prefs;
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

	const who = scopeId();
	if (who) {
		setPrefsJson(who, JSON.stringify(next));
	} else {
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
	}

	cache.set(who, next);
	return next;
}

/** Drop a user's cached prefs (e.g. when their account is removed). */
export function forgetPrefs(userId: number): void {
	cache.delete(userId);
}

export const sortFor = (prefs: Prefs, mediaType: string): SortKey =>
	prefs.sort[mediaType] ?? DEFAULT_SORT;
