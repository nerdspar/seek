<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const VIEWS = [
		{ id: 'all', label: 'All' },
		{ id: 'in_progress', label: 'In progress' },
		{ id: 'planning', label: 'Planning' },
		{ id: 'completed', label: 'Completed' },
		{ id: 'archive', label: 'Archive' }
	];

	const TITLES: Record<string, string> = {
		tv: 'My TV Shows',
		movie: 'My Movies',
		anime: 'My Anime'
	};

	const pct = (p: number, max: number | null) =>
		max && max > 0 ? Math.min(100, (p / max) * 100) : 0;
</script>

<PageHeader
	title={TITLES[data.mediaType] ?? 'Library'}
	subtitle={`${data.total} ${data.total === 1 ? 'title' : 'titles'} · ${data.viewLabel}`}
	onback={() => history.back()}
/>

<main>
	<div class="chips">
		{#each VIEWS as v (v.id)}
			<button
				class:on={data.viewKey === v.id}
				onclick={() => goto(`/library/${data.mediaType}?view=${v.id}`, { noScroll: true })}
			>{v.label}</button>
		{/each}
	</div>

	{#if data.error}
		<div class="empty"><h2>Can't load your library</h2><p>{data.error}</p></div>
	{:else if !data.rows.length}
		<div class="empty"><h2>Nothing here</h2><p>No titles with that status.</p></div>
	{:else}
		<ul class="grid">
			{#each data.rows as row (row.source + row.mediaId)}
				<li>
					<button onclick={() => goto(`/show/${row.source}/${row.mediaId}`)}>
						<Poster src={row.poster} width={104} height={156} radius={9} />
						<span class="cap">{row.title}</span>
						{#if row.maxProgress}
							<span class="track"><span class="fill" style:width={`${pct(row.progress, row.maxProgress)}%`}></span></span>
							<span class="sub tnum">{row.progress}/{row.maxProgress}</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main { padding: 4px var(--gutter) calc(var(--safe-b) + 32px); }

	.chips { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 14px; padding-bottom: 2px; }
	.chips button {
		flex: none; min-height: 34px; padding: 0 13px; border-radius: 9px;
		background: var(--surface); font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.chips button.on { background: var(--surface-raised); color: var(--text); }

	.grid {
		display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
		gap: 18px 12px; margin: 0; padding: 0; list-style: none;
	}
	.grid button { width: 100%; text-align: left; }
	.cap {
		display: -webkit-box; margin-top: 7px; font-size: 12.5px; font-weight: 600; line-height: 1.3;
		overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
	}
	.track {
		display: block; height: 4px; margin-top: 5px; border-radius: 2px;
		background: var(--surface-raised); overflow: hidden;
	}
	.fill { display: block; height: 100%; border-radius: 2px; background: var(--signal); }
	.sub { display: block; margin-top: 3px; font-size: 11px; color: var(--text-dim); }

	.empty { margin-top: 20vh; text-align: center; }
	.empty h2 { margin: 0 0 8px; font-size: 17px; }
	.empty p { margin: 0; font-size: 14px; color: var(--text-dim); }
</style>
