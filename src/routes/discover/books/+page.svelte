<script lang="ts">
	import SearchField from '$lib/components/SearchField.svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import TabBar from '$lib/components/TabBar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import BookShelf from '$lib/components/BookShelf.svelte';
	import BookSheet from '$lib/components/BookSheet.svelte';
	import UploadSheet from '$lib/components/UploadSheet.svelte';
	import { tabReselect } from '$lib/tabReselect';
	import { coverThumb, cardBadge, type DiscoveryCard } from '$lib/books';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Card = DiscoveryCard;

	let open = $state<Card | null>(null);
	let uploading = $state(false);

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
	<header>
		<div class="titlerow">
			<h1>Discover</h1>
			{#if data.canUpload}
				<div class="actions">
					<button class="icon" onclick={() => (uploading = true)} aria-label="Upload books">
						<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4m0 0-4 4m4-4 4 4M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" /></svg>
					</button>
				</div>
			{/if}
		</div>
		<div class="segments" role="tablist">
			<button role="tab" aria-selected="false" onclick={() => goto('/discover?type=tv', { noScroll: true })}>TV</button>
			<button role="tab" aria-selected="false" onclick={() => goto('/discover?type=movie', { noScroll: true })}>Movies</button>
			<button role="tab" aria-selected="true" class="on">Books</button>
		</div>
	</header>

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
						<li>
							<button class="tile" onclick={() => (open = b)}>
								<Poster src={coverThumb(b.coverUrl, 110)} width={110} height={165} radius={8} />
								{#if cardBadge(b)}<span class="owned">{cardBadge(b)}</span>{/if}
							</button>
							<span class="cap">{b.title}</span>
							<span class="sub">{[b.author, b.year].filter(Boolean).join(' · ')}</span>
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			{#await data.rails}
				{#each Array(3) as _, g (g)}
					<section class="skshelf">
						<Skeleton width="46%" height="16px" />
						<div class="skrail">{#each Array(4) as _, i (i)}<Skeleton height="165px" radius={8} />{/each}</div>
					</section>
				{/each}
			{:then rails}
				{#each rails as r (r.key)}
					<BookShelf title={r.title} subtitle={r.subtitle} books={r.books} onopen={(b) => (open = b)} />
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

{#if uploading}
	<UploadSheet onclose={() => (uploading = false)} ondone={() => invalidateAll()} />
{/if}


<style>
	/* Identical to Discover's header so Books reads as its third segment. */
	h1 { margin: 0 0 10px; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
	/* Same header icons as Profile. */
	.titlerow { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
	.titlerow h1 { margin: 0; }
	/* Negative margins: the 44px target must not make this header taller than TV/Movies'. */
	.actions { display: flex; align-items: center; gap: 2px; margin: -10px -10px -10px 0; }
	.icon {
		flex: none; display: grid; place-items: center;
		width: var(--tap); height: var(--tap);
		border-radius: 50%; color: var(--text-dim);
	}
	.segments { display: inline-flex; gap: 2px; padding: 3px; border-radius: 11px; background: var(--surface); }
	.segments button {
		min-height: 32px; padding: 0 18px; border-radius: 9px;
		font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.segments button.on { background: var(--surface-raised); color: var(--text); }

	main { padding: 6px 0 calc(var(--tabbar-footprint) + 24px); }

	.search { padding: 0 var(--gutter); margin-bottom: 18px; }

	.skshelf { display: flex; flex-direction: column; gap: 10px; padding: 0 var(--gutter); margin-bottom: 26px; }
	.skrail { display: grid; grid-template-columns: repeat(4, 110px); gap: 12px; overflow: hidden; }

	.grid {
		display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 16px 12px; margin: 0; padding: 0 var(--gutter); list-style: none;
	}
	.tile { position: relative; display: block; width: 110px; }
	.owned {
		position: absolute; left: 5px; bottom: 5px; max-width: calc(100% - 10px);
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
