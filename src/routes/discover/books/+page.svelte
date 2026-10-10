<script lang="ts">
	import DiscoverTabs from '$lib/components/DiscoverTabs.svelte';
	import { setSegment } from '$lib/segment';
	import SearchField from '$lib/components/SearchField.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import TabBar from '$lib/components/TabBar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import BookShelf from '$lib/components/BookShelf.svelte';
	import BookSheet from '$lib/components/BookSheet.svelte';
	import UploadSheet from '$lib/components/UploadSheet.svelte';
	import DownloadSheet from '$lib/components/DownloadSheet.svelte';
	import BookTileButtons from '$lib/components/BookTileButtons.svelte';
	import { tabReselect } from '$lib/tabReselect';
	import { coverThumb, cardBadge, type BookReadStatus, type DiscoveryCard } from '$lib/books';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	// Remember the segment, so the other tab opens on it too.
	$effect(() => setSegment('book'));

	type Card = DiscoveryCard;

	let open = $state<Card | null>(null);
	let uploading = $state(false);
	let downloading = $state<Card | null>(null);
	let tileNote = $state<string | null>(null);

	/* ── Genre chips: tap one for its shelves instead of the usual ones ───── */
	type Rail = { key: string; title: string; subtitle: string; books: Card[] };
	let genre = $state<string | null>(null);
	let genreRails = $state<Rail[] | null>(null);
	let genreError = $state<string | null>(null);
	async function pickGenre(g: string) {
		if (genre === g) {
			genre = null;
			genreRails = null;
			return;
		}
		genre = g;
		genreRails = null;
		genreError = null;
		try {
			const res = await fetch(`/api/books/genre?g=${encodeURIComponent(g)}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = (await res.json()) as { rails: Rail[] };
			if (genre === g) genreRails = body.rails;
		} catch (e) {
			if (genre === g) genreError = `Couldn't load ${g} — ${(e as Error).message}`;
		}
	}

	/* + on a cover: put it on your want-to-read list. One you already have (in
	   your library or your own list) opens its sheet instead, to change it. */
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

	/* ── Search the whole catalog. Debounced; a newer query cancels the older. ── */
	let query = $state('');
	let results = $state<Card[] | null>(null);
	let searching = $state(false);
	let searchError = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	function onInput() {
		clearTimeout(timer);
		const q = query.trim();
		if (!q) {
			results = null;
			searchError = null;
			return;
		}
		timer = setTimeout(() => void run(q), 300);
	}

	async function run(q: string) {
		const mine = ++seq;
		searching = true;
		searchError = null;
		try {
			const res = await fetch(`/api/books/search?q=${encodeURIComponent(q)}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = await res.json();
			if (mine === seq) results = body.results ?? [];
		} catch (e) {
			if (mine === seq) searchError = `Search failed — ${(e as Error).message}`;
		} finally {
			if (mine === seq) searching = false;
		}
	}
</script>

<div class="app">
	<DiscoverTabs active="books" media={data.media} books={true}>
		{#if data.canUpload}
			<button onclick={() => (uploading = true)} aria-label="Upload books">
				<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4m0 0-4 4m4-4 4 4M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" /></svg>
			</button>
			<button onclick={() => goto('/discover/books/library')} aria-label="In my library">
				<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="6.5" rx="1.5" /><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5" /><path d="M7 7.25h.01M7 16.75h.01" /></svg>
			</button>
		{/if}
	</DiscoverTabs>

	<main use:tabReselect={{ tab: 'discover' }}>
		<div class="search">
			<SearchField
				bind:value={query}
				placeholder="Search books, authors, series"
				oninput={onInput}
				onsubmit={() => {
					clearTimeout(timer);
					if (query.trim()) void run(query.trim());
				}}
				onclear={onInput}
			/>
		</div>
		{#if !query.trim()}
			<div class="chips" role="group" aria-label="Genres">
				{#each data.genres as g (g)}
					<button class:on={genre === g} aria-pressed={genre === g} onclick={() => pickGenre(g)}>{g}</button>
				{/each}
			</div>
		{/if}

		{#if query.trim()}
			{#if searchError}
				<p class="msg">{searchError}</p>
			{:else if results === null || (searching && !results.length)}
				<ul class="grid">
					{#each Array(6) as _, i (i)}<li><Skeleton height="165px" radius={8} /></li>{/each}
				</ul>
			{:else if !results.length}
				<p class="msg">No books match “{query.trim()}”.</p>
			{:else}
				<ul class="grid">
					{#each results as b (b.hardcoverId)}
						{@const c = added[b.hardcoverId] ? { ...b, mine: added[b.hardcoverId] } : b}
						<li>
							<div class="cover">
								<button class="tile" onclick={() => (open = c)}>
									<Poster src={coverThumb(c.coverUrl, 110)} width={110} height={165} radius={8} />
									{#if cardBadge(c)}<span class="owned">{cardBadge(c)}</span>{/if}
								</button>
								<BookTileButtons card={c} canDownload={data.canUpload} onadd={quickAdd} ondownload={(x) => (downloading = x)} />
							</div>
							<span class="cap">{b.title}</span>
							<span class="sub">{[b.author, b.year].filter(Boolean).join(' · ')}</span>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if genre}
			{#if genreError}
				<p class="msg">{genreError}</p>
			{:else if !genreRails}
				{#each Array(2) as _, g (g)}
					<section class="skshelf">
						<Skeleton width="46%" height="16px" />
						<div class="skrail">{#each Array(4) as _, i (i)}<Skeleton height="165px" radius={8} />{/each}</div>
					</section>
				{/each}
			{:else if !genreRails.length}
				<p class="msg">Nothing in {genre} right now.</p>
			{:else}
				{#each genreRails as r (r.key)}
					<BookShelf
						title={r.title}
						subtitle={r.subtitle}
						books={r.books}
						overrides={added}
						canDownload={data.canUpload}
						onopen={(b) => (open = b)}
						onadd={quickAdd}
						ondownload={(b) => (downloading = b)}
					/>
				{/each}
			{/if}
		{:else}
			<!-- Yours first: "Because you read…/like…", when there's anything to grow from. -->
			{#await data.personal then personal}
				{#each personal as r (r.key)}
					<BookShelf
						title={r.title}
						subtitle={r.subtitle}
						books={r.books}
						overrides={added}
						canDownload={data.canUpload}
						onopen={(b) => (open = b)}
						onadd={quickAdd}
						ondownload={(b) => (downloading = b)}
					/>
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
					<BookShelf
						title={r.title}
						subtitle={r.subtitle}
						books={r.books}
						overrides={added}
						canDownload={data.canUpload}
						onopen={(b) => (open = b)}
						onadd={quickAdd}
						ondownload={(b) => (downloading = b)}
					/>
				{/each}
				{#if !rails.length}<p class="msg">Hardcover returned no shelves right now.</p>{/if}
			{:catch err}
				<div class="empty"><h2>Can't reach Hardcover</h2><p>{err.message}</p></div>
			{/await}
		{/if}
	</main>

	<TabBar current="discover" />
</div>

{#if open}
	<BookSheet
		card={open}
		onclose={() => (open = null)}
		onchange={() => {
			void invalidateAll();
			// Search results are fetched here, not loaded — refresh them too.
			if (query.trim()) void run(query.trim());
		}}
	/>
{/if}

{#if downloading}
	<!-- Keyed: a different book is a fresh download, not the last one's state. -->
	{#key downloading.hardcoverId}
		<DownloadSheet book={downloading} kind="ebook" onclose={() => (downloading = null)} onchange={() => invalidateAll()} />
	{/key}
{/if}

{#if tileNote}<p class="toast" role="status">{tileNote}</p>{/if}

{#if uploading}
	<UploadSheet onclose={() => (uploading = false)} ondone={() => invalidateAll()} />
{/if}


<style>
	/* Identical to Discover's header so Books reads as its third segment. */

	main { padding: 6px 0 calc(var(--tabbar-footprint) + 24px); }

	.search { padding: 0 var(--gutter); margin-bottom: 18px; }
	/* Genre chips, as TV/Movies' mood chips: padding inside the scroller so they
	   sit level with the headings but scroll to the screen edge. */
	.chips { display: flex; gap: 6px; margin: -8px 0 20px; overflow-x: auto; padding: 0 var(--gutter) 2px; scrollbar-width: none; }
	.chips::-webkit-scrollbar { display: none; }
	.chips button {
		flex: none; min-height: 34px; padding: 0 13px; border-radius: 9px;
		background: var(--surface); font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.chips button.on { background: var(--signal); color: #fff; }

	.skshelf { display: flex; flex-direction: column; gap: 10px; padding: 0 var(--gutter); margin-bottom: 26px; }
	.skrail { display: grid; grid-template-columns: repeat(4, 110px); gap: 12px; overflow: hidden; }

	.grid {
		display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 16px 12px; margin: 0; padding: 0 var(--gutter); list-style: none;
	}
	.cover { position: relative; width: 110px; }
	.tile { position: relative; display: block; width: 110px; }
	.toast {
		position: fixed; left: var(--gutter); right: var(--gutter);
		bottom: calc(var(--tabbar-h) + var(--tabbar-safe-b) + 12px); z-index: 60;
		margin: 0; padding: 12px 14px; border-radius: 12px;
		background: var(--surface-raised); box-shadow: var(--shadow-sm); font-size: 14px;
	}
	.owned {
		position: absolute; left: 5px; bottom: 5px; max-width: calc(100% - 46px);
		padding: 3px 7px; border-radius: 6px;
		background: color-mix(in srgb, var(--bg) 82%, transparent);
		backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
		font-size: 10.5px; font-weight: 700;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.cap {
		display: block; margin-top: 6px; font-size: 12.5px; font-weight: 600;
		line-height: 1.3; overflow: hidden; display: -webkit-box;
		-webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
	}
	.sub { display: block; font-size: 11px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	.msg { margin: 40px var(--gutter); text-align: center; font-size: 14px; color: var(--text-dim); }
	.empty { margin-top: 20vh; text-align: center; padding: 0 var(--gutter); }
	.empty h2 { margin: 0 0 8px; font-size: 17px; }
	.empty p { margin: 0; font-size: 14px; color: var(--text-dim); }
</style>
