import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	authHeader,
	pickLibraryId,
	tmdbIdsFrom,
	jellyfinConfigured,
	fetchAnimeTmdbIds,
	JellyfinError
} from './jellyfin';

describe('authHeader', () => {
	it('uses the MediaBrowser Token form this Jellyfin build requires', () => {
		expect(authHeader('abc123')).toBe('MediaBrowser Token="abc123"');
	});
});

describe('pickLibraryId', () => {
	const folders = [
		{ Name: 'Shows', ItemId: 'a', CollectionType: 'tvshows' },
		{ Name: 'Anime', ItemId: 'b', CollectionType: 'tvshows' }
	];
	it('matches by name, case- and whitespace-insensitive', () => {
		expect(pickLibraryId(folders, 'anime')).toBe('b');
		expect(pickLibraryId(folders, '  Anime ')).toBe('b');
	});
	it('returns null when no library matches', () => {
		expect(pickLibraryId(folders, 'Cartoons')).toBeNull();
	});
});

describe('tmdbIdsFrom', () => {
	it('collects Tmdb ids as strings, skipping series without one, deduped', () => {
		const set = tmdbIdsFrom([
			{ ProviderIds: { Tmdb: '1429', Tvdb: '267440' } },
			{ ProviderIds: { Imdb: 'tt0000' } }, // no Tmdb → skipped
			{ ProviderIds: null },
			{ ProviderIds: { Tmdb: '1429' } } // dup
		]);
		expect([...set].sort()).toEqual(['1429']);
	});
});

describe('jellyfinConfigured / fetchAnimeTmdbIds', () => {
	// Mutate keys in place — never reassign process.env, since the $env stub
	// captured a reference to it at import time.
	beforeEach(() => {
		process.env.JELLYFIN_URL = 'https://jf.example';
		process.env.JELLYFIN_API_KEY = 'key';
		process.env.JELLYFIN_ANIME_LIBRARY = 'Anime';
	});
	afterEach(() => {
		delete process.env.JELLYFIN_URL;
		delete process.env.JELLYFIN_API_KEY;
		delete process.env.JELLYFIN_ANIME_LIBRARY;
		vi.unstubAllGlobals();
	});

	const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

	it('is configured only when url + key are both present', () => {
		expect(jellyfinConfigured()).toBe(true);
		delete process.env.JELLYFIN_API_KEY;
		expect(jellyfinConfigured()).toBe(false);
	});

	it('returns an empty set (no fetch) when unconfigured', async () => {
		delete process.env.JELLYFIN_URL;
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		expect(await fetchAnimeTmdbIds()).toEqual(new Set());
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('resolves the Anime library then returns its shows TMDB ids', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				ok([
					{ Name: 'Shows', ItemId: 'a' },
					{ Name: 'Anime', ItemId: 'anime-id' }
				])
			)
			.mockResolvedValueOnce(
				ok({ Items: [{ ProviderIds: { Tmdb: '1429' } }, { ProviderIds: { Tmdb: '240411' } }] })
			);
		vi.stubGlobal('fetch', fetchMock);

		const set = await fetchAnimeTmdbIds();
		expect(set).toEqual(new Set(['1429', '240411']));

		// second call targets the resolved library id and sends the auth header
		const [url, init] = fetchMock.mock.calls[1];
		expect(url).toContain('ParentId=anime-id');
		expect((init.headers as Record<string, string>).Authorization).toBe('MediaBrowser Token="key"');
	});

	it('throws when the Anime library is missing (so a stale set is kept)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok([{ Name: 'Shows', ItemId: 'a' }])));
		await expect(fetchAnimeTmdbIds()).rejects.toBeInstanceOf(JellyfinError);
	});

	it('throws on a non-ok response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 401 } as Response));
		await expect(fetchAnimeTmdbIds()).rejects.toMatchObject({ status: 401 });
	});
});
