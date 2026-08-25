<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const time = (iso: string | null) =>
		iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';

	const go = (offset: number) =>
		goto(offset > 0 ? `/profile/diary?offset=${offset}` : '/profile/diary');

	/* Jumping to a date means finding the page that contains it. The API pages by
	   day, and days are contiguous and newest-first, so the distance in days from
	   the newest entry gives the offset directly — no scanning. */
	let jumpTo = $state('');
	const newestDate = $derived(data.days[0]?.date ?? '');

	function jump() {
		if (!jumpTo || !newestDate) return;
		// Only days with activity are counted, so this lands near rather than
		// exactly on the target; the page then shows the surrounding days.
		const target = new Date(jumpTo).getTime();
		const newest = new Date(newestDate).getTime();
		if (Number.isNaN(target) || Number.isNaN(newest)) return;
		const daysBack = Math.max(0, Math.round((newest - target) / 86_400_000));
		go(Math.max(0, Math.min(daysBack, Math.max(0, data.total - data.pageSize))));
	}
</script>

<PageHeader
	title="Diary"
	subtitle={data.total ? `${data.offset + 1}–${Math.min(data.offset + data.pageSize, data.total)} of ${data.total} days` : null}
	onback={() => history.back()}
/>

<main>
	<div class="jump">
		<input type="date" bind:value={jumpTo} max={newestDate} aria-label="Jump to date" />
		<button onclick={jump} disabled={!jumpTo}>Go</button>
		{#if data.offset > 0}
			<button class="latest" onclick={() => go(0)}>Latest</button>
		{/if}
	</div>
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
		<div class="pager">
			<button disabled={data.offset === 0} onclick={() => go(Math.max(0, data.offset - data.pageSize))}>
				← Newer
			</button>
			<button disabled={!data.hasMore} onclick={() => go(data.offset + data.pageSize)}>
				Older →
			</button>
		</div>
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
	.jump { display: flex; gap: 8px; margin-bottom: 14px; }
	.jump input {
		flex: 1; min-width: 0; height: 38px; padding: 0 12px;
		border: none; border-radius: var(--radius);
		background: var(--surface); color: var(--text);
		font: inherit; font-size: 15px; outline: none;
	}
	.jump button {
		flex: none; min-height: 38px; padding: 0 14px; border-radius: var(--radius);
		background: var(--surface-raised); font-size: 13px; font-weight: 600;
	}
	.jump button:disabled { opacity: 0.5; }
	.latest { color: var(--signal-solid); }

	.pager { display: flex; gap: 8px; margin-top: 18px; }
	.pager button {
		flex: 1; min-height: var(--tap); border-radius: var(--radius);
		background: var(--surface); font-size: 14px; font-weight: 600;
	}
	.pager button:disabled { opacity: 0.4; }
</style>
