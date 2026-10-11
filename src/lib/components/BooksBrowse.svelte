<script lang="ts">
	import Skeleton from './Skeleton.svelte';
	import BookResults from './BookResults.svelte';
	import { type DiscoveryCard } from '$lib/books';
	import { booksView } from '$lib/booksBrowse';
	import { bookFilterQuery, type BookFilter } from '$lib/bookFilter';

	/**
	 * The Books scope of the unified search — search and the facet filter, with a
	 * "Popular now" empty state, exactly like shows and movies. Browsing the
	 * curated shelves is Discover → Books; this is for finding a specific book.
	 */
	type Card = DiscoveryCard;
	let { query, filter, canUpload, resultView }: { query: string; filter: BookFilter | null; canUpload: boolean; resultView: 'list' | 'grid' } = $props();

	const view = $derived(booksView(query, filter !== null));

	/* ── Popular books for the empty state (parallel to shows/movies trending) ── */
	let popular = $state<Card[] | null>(null);
	let popularLoaded = false;
	$effect(() => {
		if (popularLoaded || view !== 'home') return;
		popularLoaded = true;
		fetch('/api/books/discover')
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((b: { rails: { books: Card[] }[] }) => {
				popular = (b.rails?.[0]?.books ?? []).slice(0, 18);
			})
			.catch(() => {
				popular = [];
			});
	});

	/* ── Facet filter (genre / decade / sort) → a flat grid ──────────────────── */
	let filterResults = $state<Card[] | null>(null);
	let filterBusy = $state(false);
	let filterError = $state<string | null>(null);
	let filterSeq = 0;
	$effect(() => {
		if (!filter || query.trim()) return;
		const q = bookFilterQuery(filter);
		const mine = ++filterSeq;
		filterBusy = true;
		filterResults = null;
		fetch(`/api/books/filter?${q}&page=1`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((b: { results: Card[]; total: number }) => {
				if (mine !== filterSeq) return;
				filterResults = b.results ?? [];
				filterError = null;
			})
			.catch((e) => {
				if (mine === filterSeq) filterError = (e as Error).message;
			})
			.finally(() => {
				if (mine === filterSeq) filterBusy = false;
			});
	});

	/* ── Search the whole catalog, driven by the shared query. ───────────────── */
	let results = $state<Card[] | null>(null);
	let searching = $state(false);
	let searchError = $state<string | null>(null);
	let refreshKey = $state(0);
	let seq = 0;
	$effect(() => {
		const q = query.trim();
		refreshKey; // re-run after a status change so badges refresh
		if (!q) {
			results = null;
			searching = false;
			searchError = null;
			return;
		}
		searching = true;
		const mine = ++seq;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/books/search?q=${encodeURIComponent(q)}`);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const body = await res.json();
				if (mine === seq) {
					results = body.results ?? [];
					searchError = null;
				}
			} catch (e) {
				if (mine === seq) searchError = `Search failed — ${(e as Error).message}`;
			} finally {
				if (mine === seq) searching = false;
			}
		}, 300);
		return () => clearTimeout(timer);
	});
</script>

{#snippet skeletonGrid()}
	<ul class="grid">
		{#each Array(6) as _, i (i)}<li><Skeleton height="165px" radius={8} /></li>{/each}
	</ul>
{/snippet}

{#if view === 'search'}
	{#if searchError}
		<p class="msg">{searchError}</p>
	{:else if results === null || (searching && !results.length)}
		{@render skeletonGrid()}
	{:else if !results.length}
		<p class="msg">No books match “{query.trim()}”.</p>
	{:else}
		<BookResults books={results} view={resultView} canDownload={canUpload} onchange={() => refreshKey++} />
	{/if}
{:else if view === 'filter'}
	{#if filterError}
		<p class="msg">Couldn't load those filters — {filterError}</p>
	{:else if filterResults === null || (filterBusy && !filterResults.length)}
		{@render skeletonGrid()}
	{:else if !filterResults.length}
		<p class="msg">No books match those filters. Loosen one.</p>
	{:else}
		<!-- Browse is always a poster grid; the list/grid preference is for search. -->
		<BookResults books={filterResults} view="grid" canDownload={canUpload} onchange={() => refreshKey++} />
	{/if}
{:else}
	<!-- home: popular, like shows/movies "Trending now" -->
	{#if popular === null}
		{@render skeletonGrid()}
	{:else if popular.length}
		<h2 class="eyebrow">Popular now</h2>
		<BookResults books={popular} view="grid" canDownload={canUpload} />
	{:else}
		<p class="msg">Search for a book, or browse the shelves in Discover → Books.</p>
	{/if}
{/if}

<style>
	.grid {
		display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 16px 12px; margin: 0; padding: 0; list-style: none;
	}
	.eyebrow {
		margin: 16px 0 10px; font-size: 12.5px; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim);
	}
	.eyebrow:first-child { margin-top: 4px; }
	.msg { margin: 40px 0; text-align: center; font-size: 14px; color: var(--text-dim); }
</style>
