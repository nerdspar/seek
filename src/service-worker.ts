/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

/**
 * Offline shell + asset caching (Phase 1 of offline support).
 *
 * What this does and, as importantly, what it does NOT:
 * - It caches the built app (JS/CSS), the static files, poster images, and the
 *   last server-rendered version of each page you visit, so Seek opens and
 *   renders with no signal — showing the last data it saw.
 * - It deliberately ignores writes (POST/PATCH/PUT/DELETE). Those are handled by
 *   the client-side durable queue ($lib/queue), because iOS PWAs have no
 *   Background Sync — a queue that only drains while the app is open is the only
 *   thing that actually works there, and it belongs in page context, not here.
 *
 * SvelteKit auto-registers this file; `version` changes every build, which is
 * what lets `activate` drop the previous build's caches.
 */
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const APP_CACHE = `seek-app-${version}`; // hashed build assets + static files
const PAGE_CACHE = `seek-pages-${version}`; // server-rendered navigations
const IMG_CACHE = 'seek-img'; // posters — survives deploys, they never change
const IMG_MAX = 240;

/* Immutable, content-hashed — safe to keep forever and serve cache-first. */
const PRECACHE = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(APP_CACHE).then((c) => c.addAll(PRECACHE)).then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keep = new Set([APP_CACHE, PAGE_CACHE, IMG_CACHE]);
			for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
			await sw.clients.claim();
		})()
	);
});

const isPoster = (url: URL) => url.hostname === 'image.tmdb.org';

/* Trim a runtime cache to a ceiling, oldest first (insertion order). */
async function cap(cacheName: string, max: number) {
	const cache = await caches.open(cacheName);
	const keys = await cache.keys();
	for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	// Writes and anything non-GET go straight to the network; the page-context
	// queue owns their offline behaviour, not the worker.
	if (request.method !== 'GET') return;

	const url = new URL(request.url);

	// Posters: stale-while-revalidate. Show instantly from cache, refresh behind.
	if (isPoster(url)) {
		event.respondWith(
			caches.open(IMG_CACHE).then(async (cache) => {
				const hit = await cache.match(request);
				const fetching = fetch(request)
					.then((res) => {
						if (res.ok) cache.put(request, res.clone()).then(() => cap(IMG_CACHE, IMG_MAX));
						return res;
					})
					.catch(() => hit as Response);
				return hit ?? fetching;
			})
		);
		return;
	}

	if (url.origin !== location.origin) return;

	// Hashed build assets / static files: cache-first, they never change.
	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
		return;
	}

	// Navigations and same-origin GETs (including /api reads): network-first so
	// you get fresh data when you can, cache fallback so you get *something* when
	// you can't. Successful responses are cached for that next offline open.
	if (request.mode === 'navigate' || url.pathname.startsWith('/api/')) {
		event.respondWith(
			(async () => {
				try {
					const res = await fetch(request);
					if (res.ok) {
						const cache = await caches.open(PAGE_CACHE);
						cache.put(request, res.clone());
					}
					return res;
				} catch {
					const cached = await caches.match(request);
					if (cached) return cached;
					// An unseen page offline: fall back to the app's launch screen,
					// which the client then re-renders as a normal SPA route.
					if (request.mode === 'navigate') {
						const shell = await caches.match('/');
						if (shell) return shell;
					}
					throw new Error('offline and uncached');
				}
			})()
		);
	}
});

/* Lets the page tell a freshly-installed worker to take over immediately
   (used after we detect an update), rather than waiting for every tab to close. */
sw.addEventListener('message', (event) => {
	if (event.data === 'skip-waiting') sw.skipWaiting();
});
