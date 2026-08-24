<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const time = (iso: string | null) =>
		iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
</script>

<PageHeader title="Diary" onback={() => history.back()} />

<main>
	{#if data.error}
		<div class="empty"><h2>Can't load history</h2><p>{data.error}</p></div>
	{:else if !data.days.length}
		<div class="empty"><h2>Nothing logged yet</h2></div>
	{:else}
		{#each data.days as day (day.date)}
			<section>
				<h2>
					<span>{day.label}</span>
					{#if day.total}<span class="total tnum">{day.total}</span>{/if}
				</h2>
				<ul>
					{#each day.entries as e, i (day.date + i)}
						<li>
							<button
								disabled={!e.mediaId}
								onclick={() => e.mediaId && goto(`/show/${e.source}/${e.mediaId}`)}
							>
								<Poster src={e.poster} width={40} height={60} radius={6} />
								<span class="meta">
									<span class="title">{e.showTitle}</span>
									<span class="ep tnum">
										{#if e.code}{e.code}{/if}{#if e.code && e.episodeTitle} · {/if}{#if e.episodeTitle}{e.episodeTitle}{/if}
									</span>
								</span>
								<span class="at tnum">{time(e.playedAt)}</span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
		{#if data.hasMore}
			<p class="more">Showing the most recent {data.days.length} days.</p>
		{/if}
	{/if}
</main>

<style>
	main { padding: 0 var(--gutter) calc(var(--safe-b) + 32px); }
	section { margin-bottom: 20px; }
	h2 {
		display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
		margin: 0 0 8px; font-size: 12.5px; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim);
	}
	.total { font-weight: 600; text-transform: none; letter-spacing: 0; }
	ul { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
	li button {
		display: grid; grid-template-columns: 40px 1fr auto; align-items: center; gap: 12px;
		width: 100%; padding: 8px; border-radius: var(--radius); background: var(--surface);
		text-align: left; min-width: 0;
	}
	.meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.ep {
		font-size: 12px; color: var(--text-dim);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.at { font-size: 12px; color: var(--text-dim); }
	.empty { margin-top: 22vh; text-align: center; }
	.empty h2 { margin: 0 0 8px; font-size: 17px; text-transform: none; letter-spacing: 0; color: var(--text); }
	.empty p { margin: 0; font-size: 14px; color: var(--text-dim); }
	.more { margin: 8px 0 0; text-align: center; font-size: 12px; color: var(--text-dim); }
</style>
