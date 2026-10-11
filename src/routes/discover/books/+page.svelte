<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { setSegment } from '$lib/segment';
	import SearchFab from '$lib/components/SearchFab.svelte';
	import DiscoverTabs from '$lib/components/DiscoverTabs.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import BookShelf from '$lib/components/BookShelf.svelte';
	import BookSheet from '$lib/components/BookSheet.svelte';
	import UploadSheet from '$lib/components/UploadSheet.svelte';
	import DownloadSheet from '$lib/components/DownloadSheet.svelte';
	import { tabReselect } from '$lib/tabReselect';
	import { type BookReadStatus, type DiscoveryCard } from '$lib/books';
	import type { PageData } from './$types';

	/** Discover → Books: curated shelves, the books side of the TV/Movies Discover.
	 *  Finding a specific book is the unified search (the floating button). */
	let { data }: { data: PageData } = $props();
	$effect(() => setSegment('book'));

	type Card = DiscoveryCard;
	let open = $state<Card | null>(null);
	let uploading = $state(false);
	let downloading = $state<Card | null>(null);
	let tileNote = $state<string | null>(null);

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
</script>

<div class="app">
	<DiscoverTabs active="books" media={data.media} books={true}>
		<button onclick={() => goto('/discover/books/library')} aria-label="In my library">
			<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="6.5" rx="1.5" /><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5" /><path d="M7 7.25h.01M7 16.75h.01" /></svg>
		</button>
		{#if data.canUpload}
			<button onclick={() => (uploading = true)} aria-label="Upload books">
				<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4m0 0-4 4m4-4 4 4M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" /></svg>
			</button>
		{/if}
	</DiscoverTabs>

	<main use:tabReselect={{ tab: 'discover' }}>
		<!-- Yours first: "Because you read…/like…", when there's anything to grow from. -->
		{#await data.personal then personal}
			{#each personal as r (r.key)}
				<BookShelf title={r.title} subtitle={r.subtitle} books={r.books} overrides={added} canDownload={data.canUpload} onopen={(b) => (open = b)} onadd={quickAdd} ondownload={(b) => (downloading = b)} />
			{/each}
		{/await}
		{#await data.rails}
			{#each Array(3) as _, g (g)}
				<section class="skshelf">
					<Skeleton width="46%" height="16px" />
					<div class="skrail">{#each Array(4) as _, i (i)}<Skeleton height="165px" radius={8} />{/each}</div>
				</section>
			{/each}
		{:then rails}
			{#each rails as r (r.key)}
				<BookShelf title={r.title} subtitle={r.subtitle} books={r.books} overrides={added} canDownload={data.canUpload} onopen={(b) => (open = b)} onadd={quickAdd} ondownload={(b) => (downloading = b)} />
			{/each}
			{#if !rails.length}<p class="msg">Hardcover returned no shelves right now.</p>{/if}
		{:catch err}
			<div class="empty"><h2>Can't reach Hardcover</h2><p>{err.message}</p></div>
		{/await}
	</main>

	<SearchFab />
	<TabBar current="discover" />
</div>

{#if open}
	<BookSheet card={open} onclose={() => (open = null)} onchange={() => invalidateAll()} />
{/if}

{#if downloading}
	{#key downloading.hardcoverId}
		<DownloadSheet book={downloading} kind="ebook" onclose={() => (downloading = null)} onchange={() => invalidateAll()} />
	{/key}
{/if}

{#if tileNote}<p class="toast" role="status">{tileNote}</p>{/if}

{#if uploading}
	<UploadSheet onclose={() => (uploading = false)} ondone={() => invalidateAll()} />
{/if}

<style>
	main { padding: 6px 0 calc(var(--tabbar-footprint) + 24px); }
	.skshelf { display: flex; flex-direction: column; gap: 10px; padding: 0 var(--gutter); margin-bottom: 26px; }
	.skrail { display: grid; grid-template-columns: repeat(4, 110px); gap: 12px; overflow: hidden; }
	.toast {
		position: fixed; left: var(--gutter); right: var(--gutter);
		bottom: calc(var(--tabbar-h) + var(--tabbar-safe-b) + 12px); z-index: 60;
		margin: 0; padding: 12px 14px; border-radius: 12px;
		background: var(--surface-raised); box-shadow: var(--shadow-sm); font-size: 14px;
	}
	.msg { margin: 40px var(--gutter); text-align: center; font-size: 14px; color: var(--text-dim); }
	.empty { margin-top: 20vh; text-align: center; padding: 0 var(--gutter); }
	.empty h2 { margin: 0 0 8px; font-size: 17px; }
	.empty p { margin: 0; font-size: 14px; color: var(--text-dim); }
</style>
