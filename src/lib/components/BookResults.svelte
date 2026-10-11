<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Poster from './Poster.svelte';
	import BookSheet from './BookSheet.svelte';
	import DownloadSheet from './DownloadSheet.svelte';
	import BookTileButtons from './BookTileButtons.svelte';
	import { coverThumb, cardBadge, type BookReadStatus, type DiscoveryCard } from '$lib/books';

	/**
	 * A set of book results rendered as a list or a poster grid (the search-view
	 * preference), with the + / download / open-sheet actions in either shape.
	 * Self-contained — owns the book sheet and download sheet — so both the Books
	 * scope and the All scope's inline books share one renderer.
	 */
	type Card = DiscoveryCard;
	let { books, view, canDownload, onchange }: { books: Card[]; view: 'list' | 'grid'; canDownload: boolean; onchange?: () => void } = $props();

	let open = $state<Card | null>(null);
	let downloading = $state<Card | null>(null);
	let tileNote = $state<string | null>(null);
	let added = $state<Record<number, BookReadStatus>>({});

	const have = (c: Card) => Boolean(c.owned || c.mine || added[c.hardcoverId]);
	const card = (b: Card): Card => (added[b.hardcoverId] ? { ...b, mine: added[b.hardcoverId] } : b);

	async function quickAdd(c: Card) {
		if (have(c)) {
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

	function changed() {
		void invalidateAll();
		onchange?.();
	}
</script>

{#if view === 'grid'}
	<ul class="grid">
		{#each books as b (b.hardcoverId)}
			{@const c = card(b)}
			<li>
				<div class="cover">
					<button class="tile" onclick={() => (open = c)}>
						<Poster src={coverThumb(c.coverUrl, 110)} width={110} height={165} radius={8} />
						{#if cardBadge(c)}<span class="owned">{cardBadge(c)}</span>{/if}
					</button>
					<BookTileButtons card={c} {canDownload} onadd={quickAdd} ondownload={(x) => (downloading = x)} />
				</div>
				<span class="cap">{b.title}</span>
				<span class="sub">{[b.author, b.year].filter(Boolean).join(' · ')}</span>
			</li>
		{/each}
	</ul>
{:else}
	<ul class="results">
		{#each books as b (b.hardcoverId)}
			{@const c = card(b)}
			<li>
				<button class="body" onclick={() => (open = c)}>
					<Poster src={coverThumb(c.coverUrl, 46)} width={46} height={69} radius={7} />
					<span class="meta">
						<span class="title">{c.title}</span>
						<span class="sub">Book{c.author ? ` · ${c.author}` : ''}{c.year ? ` · ${c.year}` : ''}{cardBadge(c) ? ` · ${cardBadge(c)}` : ''}</span>
					</span>
				</button>
				<button class="add" class:on={have(c)} aria-label={have(c) ? `${c.title} is on your list` : `Want to read ${c.title}`} onclick={() => quickAdd(c)}>
					{#if have(c)}
						<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
					{:else}
						<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
					{/if}
				</button>
				{#if c.owned}
					<span class="dl inlib" role="img" aria-label={`${c.title} is in my library`} title="In my library">
						<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
					</span>
				{:else if canDownload}
					<button class="dl" aria-label={`Download ${c.title}`} onclick={() => (downloading = c)}>
						<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>
					</button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if open}
	<BookSheet card={open} onclose={() => (open = null)} onchange={changed} />
{/if}

{#if downloading}
	{#key downloading.hardcoverId}
		<DownloadSheet book={downloading} kind="ebook" onclose={() => (downloading = null)} onchange={changed} />
	{/key}
{/if}

{#if tileNote}<p class="toast" role="status">{tileNote}</p>{/if}

<style>
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

	.results { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
	.results li {
		display: grid; grid-template-columns: 1fr auto auto; align-items: center;
		border-radius: var(--radius); background: var(--surface);
	}
	.body {
		display: grid; grid-template-columns: 46px 1fr; align-items: center; gap: 12px;
		padding: 8px; min-width: 0; text-align: left; color: var(--text);
	}
	.meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
	.title { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.sub { display: block; font-size: 11px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	.add {
		display: grid; place-items: center; width: var(--tap); height: var(--tap);
		border-radius: 50%; background: var(--surface-raised); color: var(--text);
	}
	.add.on { background: var(--signal); color: #fff; }
	.dl {
		display: grid; place-items: center; width: var(--tap); height: var(--tap);
		margin-right: 6px; color: var(--text-dim);
	}
	.dl.inlib { color: var(--signal); }

	.toast {
		position: fixed; left: var(--gutter); right: var(--gutter);
		bottom: calc(var(--tabbar-h, 0px) + var(--safe-b) + 12px); z-index: 60;
		margin: 0; padding: 12px 14px; border-radius: 12px;
		background: var(--surface-raised); box-shadow: var(--shadow-sm); font-size: 14px;
	}
</style>
