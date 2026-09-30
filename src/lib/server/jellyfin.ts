/**
 * Read-only Jellyfin client.
 *
 * Seek uses Jellyfin for ONE thing: deciding which shows are anime. Which titles
 * live in Jellyfin's "Anime" library is the ground truth for the Shows/Anime
 * split — Floppy's own grouped-anime classifier (Kometa mapping + TMDB genre)
 * diverges from it and can't be pointed at a library, so we read the library
 * directly and mirror it into a Floppy tag (see anime-sync). Everything else
 * still comes from Floppy.
 *
 * The API key is a secret and is only ever read here — `$lib/server` is
 * unimportable from client code, which keeps it out of the browser bundle.
 *
 * Auth note: this Jellyfin build accepts only the `Authorization: MediaBrowser
 * Token="…"` header. `X-Emby-Token` and `?api_key=` both return 401.
 */
import { JELLYFIN_URL, JELLYFIN_API_KEY, JELLYFIN_ANIME_LIBRARY } from './env';

export class JellyfinError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'JellyfinError';
	}
}

/** Configured only when both a base URL and a key are present (mirrors arr.ts). */
export function jellyfinConfigured(): boolean {
	return Boolean(JELLYFIN_URL() && JELLYFIN_API_KEY());
}

/* ── Pure helpers (unit-tested directly) ──────────────────────────────────── */

export function authHeader(key: string): string {
	return `MediaBrowser Token="${key}"`;
}

type VirtualFolder = { Name?: string; ItemId?: string; CollectionType?: string };

/** ItemId of the library whose name matches (case-insensitive, trimmed), else null. */
export function pickLibraryId(folders: VirtualFolder[], name: string): string | null {
	const want = name.trim().toLowerCase();
	for (const f of folders) {
		if ((f.Name ?? '').trim().toLowerCase() === want && f.ItemId) return f.ItemId;
	}
	return null;
}

type Series = { ProviderIds?: Record<string, string> | null };

/** TMDB ids of the given series, as strings, deduped. A series without a Tmdb id
 *  is skipped: it can't be matched to a Floppy row, which keys on source+id. */
export function tmdbIdsFrom(series: Series[]): Set<string> {
	const ids = new Set<string>();
	for (const s of series) {
		const tmdb = s.ProviderIds?.Tmdb;
		if (tmdb) ids.add(String(tmdb));
	}
	return ids;
}

/* ── Transport ────────────────────────────────────────────────────────────── */

async function jf<T>(path: string, query?: Record<string, string>): Promise<T> {
	const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
	let res: Response;
	try {
		res = await fetch(`${JELLYFIN_URL()}${path}${qs}`, {
			headers: { Authorization: authHeader(JELLYFIN_API_KEY()), Accept: 'application/json' }
		});
	} catch (e) {
		throw new JellyfinError(`Jellyfin unreachable at ${path}: ${(e as Error).message}`);
	}
	if (!res.ok) throw new JellyfinError(`Jellyfin ${path} → ${res.status}`, res.status);
	return res.json() as Promise<T>;
}

/**
 * The set of TMDB show ids that live in Jellyfin's Anime library. Empty when
 * Jellyfin is not configured. Throws (for the caller to catch) on a transport,
 * auth, or missing-library error — so a stale cached set is kept rather than
 * being wiped to nothing.
 */
export async function fetchAnimeTmdbIds(): Promise<Set<string>> {
	if (!jellyfinConfigured()) return new Set();

	const folders = await jf<VirtualFolder[]>('/Library/VirtualFolders');
	const libId = pickLibraryId(folders, JELLYFIN_ANIME_LIBRARY());
	if (!libId) {
		throw new JellyfinError(`Anime library "${JELLYFIN_ANIME_LIBRARY()}" not found in Jellyfin`);
	}

	const page = await jf<{ Items?: Series[] }>('/Items', {
		ParentId: libId,
		Recursive: 'true',
		IncludeItemTypes: 'Series',
		Fields: 'ProviderIds',
		Limit: '2000'
	});
	return tmdbIdsFrom(page.Items ?? []);
}
