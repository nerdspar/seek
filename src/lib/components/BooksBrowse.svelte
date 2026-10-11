<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Skeleton from './Skeleton.svelte';
	import BookShelf from './BookShelf.svelte';
	import BookSheet from './BookSheet.svelte';
	import DownloadSheet from './DownloadSheet.svelte';
	import BookResults from './BookResults.svelte';
	import { type BookReadStatus, type DiscoveryCard } from '$lib/books';
	import { booksView } from '$lib/booksBrowse';
	import { bookFilterQuery, type BookFilter } from '$lib/bookFilter';

	/**
	 * The whole Books finding surface — search, facet filter and the home
	 * shelves — as one component so the unified search's Books scope is exactly
	 * what Discover → Books used to be. The query and the filter are driven from
	 * outside (the one search field and the filter sheet); everything else it owns.
	 */
	type Card = DiscoveryCard;
	type Rail = { key: string; title: string; subtitle: string; books: Card[] };
	let { query, filter, canUpload, resultView }: { query: string; filter: BookFilter | null; canUpload: boolean; resultView: 'list' | 'grid' } = $props();

	let open = $state<Card | null>(null);
	let downloading = $state<Card | null>(null);
	let tileNote = $state<string | null>(null);

	const view = $derived(booksView(query, filter !== null));

	/* ── Home shelves: the standard discovery rails and the personal ones ───── */
	let homeRails = $state<Rail[] | null>(null);
	let personalRails = $state<Rail[]>([]);
	let homeError = $state<string | null>(null);
	let homeLoaded = false;
	$effect(() => {
		// Load once, the first time the home view is actually shown.
		if (homeLoaded || view !== 'home') return;
		homeLoaded = true;
		fetch('/api/books/discover')
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
			.then((b: { rails: Rail[]; personal: Rail[] }) => {
				homeRails = b.rails ?? [];
				personalRails = b.personal ?? [];
			})
			.catch((e) => {
				homeError = (e as Error).message;
				homeRails = [];
			});
	});

	/* ── Facet filter (genre / decade / sort) → a flat grid ──────────────────── */
	let filterResults = $state<Card[] | null>(null);
	let filterTotal = $state(0);
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
				filterTotal = b.total ?? 0;
				filterError = null;
			})
			.catch((e) => {
				if (mine === filterSeq) filterError = (e as Error).message;
			})
			.finally(() => {
				if (mine === filterSeq) filterBusy = false;
			});
	});

	/* + on a cover: put it on your want-to-read list. One you already have opens
	   its sheet instead, to change it. */
	let added = $state<Record<number, BookReadStatus>>({});
	async function quickAdd(c: Card) {
		if (c.owned || c.mine || added[c.hardcoverId]) {
			open = c;
			return;
		}
		added = { ...added, [c.hardcoverId]: 'want_to_read' };
		try {
			const res = await fetch('/api/books/mine', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ hardcoverId: c.hardcoverId, status: 'want_to_read' })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			tileNote = `Added “${c.title}” to Want to read`;
		} catch (e) {
			const { [c.hardcoverId]: _, ...rest } = added;
			added = rest;
			tileNote = `Couldn't add “${c.title}” — ${(e as Error).message}`;
		}
		setTimeout(() => (tileNote = null), 2500);
	}

	/* ── Search the whole catalog, driven by the shared query. Debounced; a
	   newer query cancels the older. ──────────────────────────────────────── */
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
	<!-- home -->
	{#each personalRails as r (r.key)}
		<BookShelf title={r.title} subtitle={r.subtitle} books={r.books} overrides={added} canDownload={canUpload} onopen={(b) => (open = b)} onadd={quickAdd} ondownload={(b) => (downloading = b)} />
	{/each}
	{#if homeRails === null}
		{#each Array(3) as _, g (g)}
			<section class="skshelf">
				<Skeleton width="46%" height="16px" />
				<div class="skrail">{#each Array(4) as _, i (i)}<Skeleton height="165px" radius={8} />{/each}</div>
			</section>
		{/each}
	{:else if homeError}
		<p class="msg">Can't reach Hardcover — {homeError}</p>
	{:else}
		{#each homeRails as r (r.key)}
			<BookShelf title={r.title} subtitle={r.subtitle} books={r.books} overrides={added} canDownload={canUpload} onopen={(b) => (open = b)} onadd={quickAdd} ondownload={(b) => (downloading = b)} />
		{/each}
		{#if !homeRails.length && !personalRails.length}<p class="msg">Hardcover returned no shelves right now.</p>{/if}
	{/if}
{/if}

{#if open}
	<BookSheet
		card={open}
		onclose={() => (open = null)}
		onchange={() => {
			void invalidateAll();
			refreshKey++; // re-fetch search results so the changed book's badge updates
		}}
	/>
{/if}

{#if downloading}
	{#key downloading.hardcoverId}
		<DownloadSheet book={downloading} kind="ebook" onclose={() => (downloading = null)} onchange={() => invalidateAll()} />
	{/key}
{/if}

{#if tileNote}<p class="toast" role="status">{tileNote}</p>{/if}

<style>
	.skshelf { display: flex; flex-direction: column; gap: 10px; margin-bottom: 26px; }
	.skrail { display: grid; grid-template-columns: repeat(4, 110px); gap: 12px; overflow: hidden; }

	.grid {
		display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 16px 12px; margin: 0; padding: 0; list-style: none;
	}

	.toast {
		position: fixed; left: var(--gutter); right: var(--gutter);
		bottom: calc(var(--tabbar-h, 0px) + var(--safe-b) + 12px); z-index: 60;
		margin: 0; padding: 12px 14px; border-radius: 12px;
		background: var(--surface-raised); box-shadow: var(--shadow-sm); font-size: 14px;
	}
	.msg { margin: 40px 0; text-align: center; font-size: 14px; color: var(--text-dim); }
</style>
