<script lang="ts">
	import { setSegment } from '$lib/segment';
	import SearchFab from '$lib/components/SearchFab.svelte';
	import DiscoverTabs from '$lib/components/DiscoverTabs.svelte';
	import NotLinked from '$lib/components/NotLinked.svelte';
	import { notLinkedOf } from '$lib/notLinked';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Poster from '$lib/components/Poster.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import { tabReselect } from '$lib/tabReselect';
	import AddButton from '$lib/components/AddButton.svelte';
	import ArrButton from '$lib/components/ArrButton.svelte';
	import ArrAddSheet from '$lib/components/ArrAddSheet.svelte';
	import { loadArrStatus } from '$lib/arr.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import type { Snapshot } from '@sveltejs/kit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	// Remember the segment, so the other tab opens on it too.
	$effect(() => setSegment(data.mediaType === 'movie' ? 'movie' : 'tv'));

	let note = $state<string | null>(null);
	/** The title whose Sonarr/Radarr add sheet is open. One sheet for the page. */
	let arrRequest = $state<{ mediaType: string; tmdbId: string; title: string } | null>(null);
	onMount(() => void loadArrStatus());

	/* Finding something specific — a title, an actor, a mood, a tag — is the
	   unified search's job now (the floating button). Discover is the curated
	   shelves; its only state is each rail's scroll, kept across a back nav. */
	const railScroll: Record<string, number> = {};
	const railNodes = new Set<HTMLElement>();
	function keepRailScroll(node: HTMLElement, key: string) {
		let k = key;
		railNodes.add(node);
		const save = () => {
			railScroll[k] = node.scrollLeft;
		};
		// Retry briefly: the row streams in and restore() may land either side of
		// this mount, so re-check the saved offset until it takes (or there is
		// none). Stops as soon as it sticks, to keep out of a user's way.
		let tries = 0;
		const apply = () => {
			const want = railScroll[k];
			if (want && node.scrollWidth > node.clientWidth + 4) {
				node.scrollLeft = want;
				if (Math.abs(node.scrollLeft - want) < 2) return;
			}
			if (tries++ < 40) requestAnimationFrame(apply);
		};
		requestAnimationFrame(apply);
		node.addEventListener('scroll', save, { passive: true });
		return {
			update(next: string) {
				k = next;
			},
			destroy() {
				node.removeEventListener('scroll', save);
				railNodes.delete(node);
			}
		};
	}
	export const snapshot: Snapshot<Record<string, number>> = {
		capture: () => ({ ...railScroll }),
		restore: (v) => {
			for (const key of Object.keys(railScroll)) delete railScroll[key];
			Object.assign(railScroll, v ?? {});
		}
	};

	const open = (mediaType: string, source: string, mediaId: string) =>
		goto(`/${mediaType === 'movie' ? 'movie' : 'show'}/${source}/${mediaId}`);
</script>

<div class="app">
	<DiscoverTabs
		active={data.mediaType === 'movie' ? 'movie' : 'tv'}
		media={data.media}
	>
		{#if data.onServer}
			<button onclick={() => goto(`/discover/server/${data.mediaType === 'movie' ? 'movie' : 'tv'}`)} aria-label="On the server">
				<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="6.5" rx="1.5" /><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5" /><path d="M7 7.25h.01M7 16.75h.01" /></svg>
			</button>
		{/if}
	</DiscoverTabs>

<!-- Every slow path shows the same breathing shelves rather than a line of text,
     so a tap always produces something that reads as work in progress. -->
{#snippet skeletonShelves(count: number)}
	{#each Array(count) as _, g (g)}
		<section class="shelf">
			<div class="skhead"><Skeleton width="46%" height="16px" /><Skeleton width="66%" height="12px" /></div>
			<ul class="rail">
				{#each Array(4) as _, i (i)}
					<li><Skeleton height="165px" radius={10} /><Skeleton height="12px" /></li>
				{/each}
			</ul>
		</section>
	{/each}
{/snippet}

	<main use:tabReselect={{ tab: 'discover' }}>
		{#await data.rows}
			{@render skeletonShelves(3)}
		{:then rows}
			{#if !rows.length}
				<div class="empty"><h2>Nothing to suggest yet</h2><p>These rows come from TMDB and what you watch. Check the TMDB key under Settings → Services.</p></div>
			{:else}
				{#each rows as row (row.key)}
					<section class="shelf">
						<h2>{row.title}</h2>
						{#if row.why}<p class="why">{row.why}</p>{/if}
						<ul class="rail" use:keepRailScroll={'row:' + row.key}>
							{#each row.items as item (item.mediaId)}
								<li>
									<button class="tile" onclick={() => open(item.mediaType, item.source, item.mediaId)}>
										<Poster src={item.poster} width={110} height={165} radius={10} />
										<span class="add"><AddButton mediaType={item.mediaType} source={item.source} mediaId={item.mediaId} title={item.title} added={item.tracked ?? false} onerror={(m) => (note = m)} /></span>
										<span class="arradd"><ArrButton mediaType={item.mediaType} tmdbId={item.mediaId} title={item.title} onadd={(i) => (arrRequest = i)} compact size={30} /></span>
									</button>
									<span class="cap">{item.title}</span>
									<span class="sub tnum">{[item.year, item.rating ? `★ ${item.rating}` : null].filter(Boolean).join(' · ')}</span>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			{/if}
		{:catch err}
			{@const missing = notLinkedOf(err)}
			{#if missing}<NotLinked service={missing} />{:else}<div class="empty"><h2>Can't load Discover</h2><p>{err.message}</p></div>{/if}
		{/await}
	</main>

	<SearchFab />

	<TabBar current="discover" onunbuilt={(l) => (note = `${l} — not built yet (build order §13).`)} />

	{#if note}
		<div class="note" role="status">
			<span>{note}</span>
			<button onclick={() => (note = null)} aria-label="Dismiss">×</button>
		</div>
	{/if}

	{#if arrRequest}
		<ArrAddSheet item={arrRequest} onclose={() => (arrRequest = null)} />
	{/if}
</div>

<style>
	/* Frame from the global `.app` shell (app.css). */

	main { padding: 6px 0 calc(var(--tabbar-footprint) + 24px); }



	.shelf { margin-bottom: 26px; }
	.skhead { display: flex; flex-direction: column; gap: 6px; padding: 0 var(--gutter); }
	.rail li :global(.sk + .sk) { margin-top: 7px; }
	.shelf h2 { margin: 0 var(--gutter) 2px; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
	.why { margin: 0 var(--gutter) 8px; font-size: 12.5px; color: var(--text-dim); }

	.rail { margin: 8px 0 0; padding: 0; list-style: none; }
	.rail {
		display: flex; gap: 12px; overflow-x: auto;
		padding: 0 var(--gutter) 4px;
		scroll-snap-type: x proximity;
		/* Without this the snap engine aligns the first tile to the container
		   edge and scrolls the gutter away, so the shelf starts flush left while
		   its heading is indented. */
		scroll-padding-left: var(--gutter);
	}
	.rail li { flex: none; width: 110px; scroll-snap-align: start; }

	.tile { position: relative; display: block; width: 110px; }
	.add { position: absolute; right: 5px; bottom: 5px; }
	.arradd { position: absolute; right: 5px; top: 5px; }

	.cap {
		display: block; margin-top: 6px; font-size: 12.5px; font-weight: 600;
		line-height: 1.3; overflow: hidden; display: -webkit-box;
		-webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
	}
	.sub { display: block; font-size: 11px; color: var(--text-dim); }

	.empty { margin-top: 20vh; text-align: center; padding: 0 var(--gutter); }
	.empty h2 { margin: 0 0 8px; font-size: 17px; }
	.empty p { margin: 0; font-size: 14px; color: var(--text-dim); }

	.note {
		position: fixed; left: var(--gutter); right: var(--gutter);
		bottom: calc(var(--tabbar-h) + var(--tabbar-safe-b) + 12px); z-index: 60;
		display: flex; align-items: center; gap: 10px;
		padding: 12px 8px 12px 16px; border-radius: var(--radius);
		background: var(--surface-raised); box-shadow: var(--shadow-lg);
		font-size: 13.5px;
	}
	.note span { flex: 1; }
	.note button { flex: none; width: var(--tap); height: var(--tap); font-size: 22px; color: var(--text-dim); }
</style>
