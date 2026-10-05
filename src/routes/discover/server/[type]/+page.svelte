<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import AddButton from '$lib/components/AddButton.svelte';
	import type { PageData } from './$types';

	/** On the server, not on your list. The + puts one on your list (Planning);
	 *  it stays here, ticked, until you leave. */
	let { data }: { data: PageData } = $props();
	let note = $state<string | null>(null);
	const noun = (n: number) => (data.mediaType === 'tv' ? (n === 1 ? 'show' : 'shows') : n === 1 ? 'movie' : 'movies');
	const from = $derived(data.mediaType === 'tv' ? 'Sonarr' : 'Radarr');
</script>

{#await data.titles then titles}
	<PageHeader title="On the server" subtitle={`${titles.length} ${noun(titles.length)} not on your list`} onback={() => history.back()} />
{:catch}
	<PageHeader title="On the server" onback={() => history.back()} />
{/await}

<main>
	{#await data.titles}
		<ul class="grid">
			{#each Array(12) as _, i (i)}
				<li><Skeleton height="156px" radius={9} /><Skeleton height="12px" /></li>
			{/each}
		</ul>
	{:then titles}
		{#if !titles.length}
			<div class="empty"><h2>All caught up</h2><p>Everything in {from} is on your list.</p></div>
		{:else}
			<p class="why">In {from}, but not on your list — newest first.</p>
			<ul class="grid">
				{#each titles as t (t.mediaId)}
					<li>
						<button class="tile" onclick={() => goto(`/${t.mediaType === 'movie' ? 'movie' : 'show'}/${t.source}/${t.mediaId}`)}>
							<Poster src={t.poster} width={104} height={156} radius={9} />
							<span class="add"><AddButton mediaType={t.mediaType} source={t.source} mediaId={t.mediaId} title={t.title} onerror={(m) => (note = m)} /></span>
						</button>
						<span class="cap">{t.title}</span>
						{#if t.year}<span class="sub tnum">{t.year}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{:catch err}
		<div class="empty"><h2>Can't reach {from}</h2><p>{err.message}</p></div>
	{/await}
</main>

{#if note}
	<div class="note" role="status">
		<span>{note}</span>
		<button onclick={() => (note = null)} aria-label="Dismiss">×</button>
	</div>
{/if}

<style>
	main { padding: 4px var(--gutter) calc(var(--safe-b) + 32px); }
	.why { margin: 0 0 12px; font-size: 13px; color: var(--text-dim); }
	.grid {
		display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
		gap: 18px 12px; margin: 0; padding: 0; list-style: none;
	}
	.grid li :global(.sk + .sk) { margin-top: 7px; }
	.tile { position: relative; display: block; width: 100%; text-align: left; }
	.add { position: absolute; right: 5px; bottom: 5px; }
	.cap {
		display: -webkit-box; margin-top: 7px; font-size: 12.5px; font-weight: 600; line-height: 1.3;
		overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
	}
	.sub { display: block; margin-top: 3px; font-size: 11px; color: var(--text-dim); }
	.empty { margin-top: 20vh; text-align: center; }
	.empty h2 { margin: 0 0 8px; font-size: 17px; }
	.empty p { margin: 0; font-size: 14px; color: var(--text-dim); }
	.note {
		position: fixed; left: var(--gutter); right: var(--gutter); bottom: calc(var(--safe-b) + 16px); z-index: 60;
		display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 12px;
		background: var(--surface-raised); box-shadow: var(--shadow-sm); font-size: 14px;
	}
	.note span { flex: 1; }
</style>
