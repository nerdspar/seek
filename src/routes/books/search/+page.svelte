<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import BookSheet from '$lib/components/BookSheet.svelte';
	import DownloadSheet from '$lib/components/DownloadSheet.svelte';
	import BookTileButtons from '$lib/components/BookTileButtons.svelte';
	import {
		cardBadge,
		coverThumb,
		normTitle,
		statusLabel,
		type BookReadStatus,
		type DiscoveryCard,
		type MyBook
	} from '$lib/books';
	import type { PageData } from './$types';

	/** The book version of Add to library — looks and works like the shows and
	 *  movies search: one box, results with + and download, suggestions when the
	 *  box is empty. Tapping a book opens its sheet (status, rating, pages…). */
	let { data }: { data: PageData } = $props();

	type Scope = 'all' | 'yours';
	let query = $state('');
	let scope = $state<Scope>('all');
	let results = $state<DiscoveryCard[]>([]);
	let searching = $state(false);
	let failed = $state<string | null>(null);
	let input: HTMLInputElement | undefined = $state();
	let note = $state<string | null>(null);

	let openCard = $state<DiscoveryCard | null>(null);
	let openBook = $state<MyBook | null>(null);
	let downloading = $state<DiscoveryCard | null>(null);
	let added = $state<Record<number, BookReadStatus>>({});
	/* Your books was loaded with the page: after an add, reload it before showing it. */
	let stale = false;
	function setScope(next: Scope) {
		scope = next;
		if (next === 'yours' && stale) {
			stale = false;
			void invalidateAll();
		}
	}
	const shown = (c: DiscoveryCard) => (added[c.hardcoverId] ? { ...c, mine: added[c.hardcoverId] } : c);

	/* Search: debounced; a newer query cancels the older. */
	let seq = 0;
	$effect(() => {
		const q = query.trim();
		if (!q || scope !== 'all') {
			results = [];
			searching = false;
			return;
		}
		searching = true;
		failed = null;
		const mine = ++seq;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/books/search?q=${encodeURIComponent(q)}`);
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const body = await res.json();
				if (mine === seq) results = body.results ?? [];
			} catch (e) {
				if (mine === seq) failed = `Search failed — ${(e as Error).message}`;
			} finally {
				if (mine === seq) searching = false;
			}
		}, 300);
		return () => clearTimeout(timer);
	});

	/* + : on your want-to-read list; one you already have opens its sheet. */
	async function quickAdd(c: DiscoveryCard) {
		const card = shown(c);
		if (card.owned || card.mine) {
			openCard = card;
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
			note = `Added “${c.title}” to Want to read`;
			stale = true;
		} catch (e) {
			const { [c.hardcoverId]: _, ...rest } = added;
			added = rest;
			note = `Couldn't add “${c.title}” — ${(e as Error).message}`;
		}
		setTimeout(() => (note = null), 2500);
	}

	const yours = (books: MyBook[]) => {
		const q = normTitle(query);
		if (!q) return books.slice(0, 30);
		return books.filter((b) => normTitle(b.title).includes(q) || b.authors.some((a) => a.toLowerCase().includes(query.trim().toLowerCase())));
	};
</script>

<PageHeader title="Add a book" onback={() => history.back()} />

<main>
	<div class="field">
		<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
			<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" stroke-linecap="round" />
		</svg>
		<input
			bind:this={input}
			bind:value={query}
			type="search"
			placeholder="Search books and authors"
			autocapitalize="off"
			autocorrect="off"
			spellcheck="false"
			enterkeyhint="search"
		/>
		{#if query}
			<button class="clear" onclick={() => { query = ''; input?.focus(); }} aria-label="Clear">×</button>
		{/if}
	</div>

	<div class="chips" role="tablist">
		<button role="tab" aria-selected={scope === 'all'} class:on={scope === 'all'} onclick={() => setScope('all')}>All books</button>
		<button role="tab" aria-selected={scope === 'yours'} class:on={scope === 'yours'} onclick={() => setScope('yours')}>Your books</button>
	</div>

	{#if scope === 'yours'}
		{#await data.books then books}
			{@const list = yours(books)}
			{#if !list.length}
				<p class="msg">{query.trim() ? `None of your books match “${query.trim()}”.` : 'No books on your list or in your library yet.'}</p>
			{:else}
				<ul class="results">
					{#each list as b (b.key)}
						<li>
							<button class="body" onclick={() => (openBook = b)}>
								<Poster src={coverThumb(b.coverUrl, 46)} width={46} height={69} radius={7} />
								<span class="meta">
									<span class="title">{b.title}</span>
									<span class="sub">{[b.authors[0], statusLabel(b.status)].filter(Boolean).join(' · ')}</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/await}
	{:else if failed}
		<p class="msg error">{failed}</p>
	{:else if !query.trim()}
		{#await data.suggestions then rails}
			{#each rails as r (r.key)}
				<h2 class="eyebrow">{r.title}</h2>
				<ul class="grid">
					{#each r.books.slice(0, 12) as raw (raw.hardcoverId)}
						{@const c = shown(raw)}
						<li>
							<button onclick={() => (openCard = c)}>
								<Poster src={coverThumb(c.coverUrl, 104)} width={104} height={156} radius={9} />
								{#if cardBadge(c)}<span class="badge">{cardBadge(c)}</span>{/if}
								<span class="cap">{c.title}</span>
								<span class="sub tnum">{[c.author, c.year].filter(Boolean).join(' · ')}</span>
							</button>
							<span class="tilebtns"><BookTileButtons card={c} canDownload={data.canDownload} onadd={quickAdd} ondownload={(x) => (downloading = x)} /></span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="msg">Search for any book to add it.</p>
			{/each}
		{/await}
	{:else if searching && !results.length}
		<p class="msg">Searching…</p>
	{:else if !results.length}
		<p class="msg">Nothing found for “{query.trim()}”.</p>
	{:else}
		<ul class="results">
			{#each results as raw (raw.hardcoverId)}
				{@const c = shown(raw)}
				{@const have = Boolean(c.owned || c.mine)}
				<li>
					<button class="body" onclick={() => (openCard = c)}>
						<Poster src={coverThumb(c.coverUrl, 46)} width={46} height={69} radius={7} />
						<span class="meta">
							<span class="title">{c.title}</span>
							<span class="sub tnum">{[c.author, c.year, cardBadge(c)].filter(Boolean).join(' · ')}</span>
						</span>
					</button>
					<button class="add" class:on={have} aria-label={have ? `${c.title} — open` : `Want to read ${c.title}`} onclick={() => quickAdd(c)}>
						{#if have}
							<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
						{:else}
							<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
						{/if}
					</button>
					{#if data.canDownload && !c.owned}
						<button class="dl" aria-label={`Download ${c.title}`} onclick={() => (downloading = c)}>
							<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
						</button>
					{:else}
						<span></span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>

{#if openCard || openBook}
	<BookSheet card={openCard} book={openBook} onclose={() => { openCard = null; openBook = null; }} onchange={() => invalidateAll()} />
{/if}
{#if downloading}
	{#key downloading.hardcoverId}
		<DownloadSheet book={downloading} kind="ebook" onclose={() => (downloading = null)} onchange={() => invalidateAll()} />
	{/key}
{/if}
{#if note}<p class="toast" role="status">{note}</p>{/if}

<style>
	main { padding: 4px var(--gutter) calc(var(--safe-b) + 32px); }
	.field {
		display: flex; align-items: center; gap: 9px; height: var(--tap); padding: 0 12px;
		border-radius: var(--radius); background: var(--surface); color: var(--text-dim);
	}
	.field input {
		flex: 1; min-width: 0; border: none; background: none; color: var(--text);
		font: inherit; font-size: 16px; outline: none; -webkit-appearance: none; appearance: none;
	}
	.field input::-webkit-search-cancel-button { display: none; }
	.clear { flex: none; width: 28px; height: 28px; font-size: 20px; color: var(--text-dim); }
	.chips { display: flex; gap: 6px; margin: 10px 0 14px; overflow-x: auto; }
	.chips button {
		flex: none; min-height: 34px; padding: 0 13px; border-radius: 9px;
		background: var(--surface); font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.chips button.on { background: var(--surface-raised); color: var(--text); }
	.msg { margin: 40px 0; text-align: center; font-size: 14px; color: var(--text-dim); }
	.msg.error { color: #ff8a8a; }
	.eyebrow {
		margin: 14px 0 10px; font-size: 12.5px; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim);
	}
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 16px 12px; margin: 0; padding: 0; list-style: none; }
	.grid li { position: relative; }
	.grid li > button { position: relative; width: 100%; text-align: left; }
	.tilebtns { position: absolute; left: 0; top: 0; width: 104px; height: 156px; pointer-events: none; }
	.tilebtns :global(button) { pointer-events: auto; }
	.badge {
		position: absolute; left: 5px; top: 133px; max-width: calc(100% - 46px);
		padding: 2px 6px; border-radius: 6px; font-size: 10px; font-weight: 700;
		background: color-mix(in srgb, var(--bg) 82%, transparent);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.cap {
		display: -webkit-box; margin-top: 6px; font-size: 12.5px; font-weight: 600; line-height: 1.3;
		overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
	}
	.sub { display: block; font-size: 11px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.results { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
	.results li { display: grid; grid-template-columns: 1fr auto auto; align-items: center; border-radius: var(--radius); background: var(--surface); }
	.body { display: grid; grid-template-columns: 46px 1fr; align-items: center; gap: 12px; padding: 8px; min-width: 0; text-align: left; }
	.meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
	.title { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.results .sub { font-size: 12px; }
	.add, .dl {
		display: grid; place-items: center; width: 38px; height: 38px; margin-right: 6px;
		border-radius: 50%; background: var(--surface-raised); color: var(--text);
	}
	.add.on { background: var(--signal); color: #fff; }
	.toast {
		position: fixed; left: var(--gutter); right: var(--gutter); bottom: calc(var(--safe-b) + 16px); z-index: 60;
		margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--surface-raised); box-shadow: var(--shadow-sm); font-size: 14px;
	}
</style>
