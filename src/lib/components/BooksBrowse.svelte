<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Skeleton from './Skeleton.svelte';
	import Poster from './Poster.svelte';
	import BookShelf from './BookShelf.svelte';
	import BookSheet from './BookSheet.svelte';
	import UploadSheet from './UploadSheet.svelte';
	import DownloadSheet from './DownloadSheet.svelte';
	import BookTileButtons from './BookTileButtons.svelte';
	import { coverThumb, cardBadge, type BookReadStatus, type DiscoveryCard } from '$lib/books';
	import { booksView } from '$lib/booksBrowse';

	/**
	 * The whole Books finding surface — search, genre browse, and the home
	 * shelves — as one component so the unified search's Books scope is exactly
	 * what Discover → Books used to be. The query is driven from outside (the one
	 * search field); everything else it owns.
	 */
	type Card = DiscoveryCard;
	type Rail = { key: string; title: string; subtitle: string; books: Card[] };
	let { query, genres, canUpload }: { query: string; genres: string[]; canUpload: boolean } = $props();

	let open = $state<Card | null>(null);
	let uploading = $state(false);
	let downloading = $state<Card | null>(null);
	let tileNote = $state<string | null>(null);

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

	/* ── Genre chips: tap one for its shelves ─────────────────────────────── */
	let genre = $state<string | null>(null);
	let genreRails = $state<Rail[] | null>(null);
	let genreError = $state<string | null>(null);
	const view = $derived(booksView(query, genre));
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

	const card = (b: Card): Card => (added[b.hardcoverId] ? { ...b, mine: added[b.hardcoverId] } : b);
</script>

{#if view !== 'search'}
	<div class="toolbar">
		<div class="chips" role="group" aria-label="Genres">
			{#each genres as g (g)}
				<button class:on={genre === g} aria-pressed={genre === g} onclick={() => pickGenre(g)}>{g}</button>
			{/each}
		</div>
		<div class="acts">
			<button class="act" onclick={() => goto('/discover/books/library')} aria-label="In my library">
				<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="6.5" rx="1.5" /><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5" /><path d="M7 7.25h.01M7 16.75h.01" /></svg>
			</button>
			{#if canUpload}
				<button class="act" onclick={() => (uploading = true)} aria-label="Upload books">
					<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4m0 0-4 4m4-4 4 4M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" /></svg>
				</button>
			{/if}
		</div>
	</div>
{/if}

{#if view === 'search'}
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
				{@const c = card(b)}
				<li>
					<div class="cover">
						<button class="tile" onclick={() => (open = c)}>
							<Poster src={coverThumb(c.coverUrl, 110)} width={110} height={165} radius={8} />
							{#if cardBadge(c)}<span class="owned">{cardBadge(c)}</span>{/if}
						</button>
						<BookTileButtons card={c} canDownload={canUpload} onadd={quickAdd} ondownload={(x) => (downloading = x)} />
					</div>
					<span class="cap">{b.title}</span>
					<span class="sub">{[b.author, b.year].filter(Boolean).join(' · ')}</span>
				</li>
			{/each}
		</ul>
	{/if}
{:else if view === 'genre'}
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
			<BookShelf title={r.title} subtitle={r.subtitle} books={r.books} overrides={added} canDownload={canUpload} onopen={(b) => (open = b)} onadd={quickAdd} ondownload={(b) => (downloading = b)} />
		{/each}
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

{#if uploading}
	<UploadSheet onclose={() => (uploading = false)} ondone={() => invalidateAll()} />
{/if}

<style>
	.toolbar { display: flex; align-items: center; gap: 8px; margin: 0 0 18px; }
	.chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; flex: 1; min-width: 0; }
	.chips::-webkit-scrollbar { display: none; }
	.chips button {
		flex: none; min-height: 34px; padding: 0 13px; border-radius: 9px;
		background: var(--surface); font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.chips button.on { background: var(--signal); color: #fff; }
	.acts { display: flex; gap: 4px; flex: none; }
	.act { display: grid; place-items: center; width: 34px; min-height: 34px; border-radius: 9px; background: var(--surface); color: var(--text-dim); }

	.skshelf { display: flex; flex-direction: column; gap: 10px; margin-bottom: 26px; }
	.skrail { display: grid; grid-template-columns: repeat(4, 110px); gap: 12px; overflow: hidden; }

	.grid {
		display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 16px 12px; margin: 0; padding: 0; list-style: none;
	}
	.cover { position: relative; width: 110px; }
	.tile { position: relative; display: block; width: 110px; }
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

	.toast {
		position: fixed; left: var(--gutter); right: var(--gutter);
		bottom: calc(var(--tabbar-h, 0px) + var(--safe-b) + 12px); z-index: 60;
		margin: 0; padding: 12px 14px; border-radius: 12px;
		background: var(--surface-raised); box-shadow: var(--shadow-sm); font-size: 14px;
	}
	.msg { margin: 40px 0; text-align: center; font-size: 14px; color: var(--text-dim); }
</style>
