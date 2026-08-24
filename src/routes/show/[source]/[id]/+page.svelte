<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import { formatAirDate, formatRuntime } from '$lib/format';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const show = $derived(data.show);

	const year = (iso: string | null) => (iso ? new Date(iso).getFullYear() : null);
	const pct = (p: number | null, max: number | null) =>
		max && max > 0 && p !== null ? Math.min(100, (p / max) * 100) : 0;

	const years = $derived(
		[year(show.firstAirDate), show.status === 'Ended' ? year(show.lastAirDate) : null]
			.filter((y): y is number => y !== null)
	);
	const yearLabel = $derived(
		years.length === 2 && years[0] !== years[1] ? `${years[0]}–${years[1]}` : String(years[0] ?? '')
	);

	// Specials (season 0) sort last — they're rarely what you came for.
	const seasons = $derived(
		[...show.seasons].sort((a, b) =>
			a.seasonNumber === 0 ? 1 : b.seasonNumber === 0 ? -1 : a.seasonNumber - b.seasonNumber
		)
	);
</script>

<PageHeader title={show.title} subtitle={yearLabel || null} onback={() => history.back()} />

<main>
	<section class="hero">
		<Poster src={show.poster} width={104} height={156} radius={10} eager />
		<div class="facts">
			<h1>{show.title}</h1>
			<p class="chips tnum">
				{#if show.status}<span class="chip">{show.status}</span>{/if}
				{#if show.score}<span class="chip">★ {show.score.toFixed(1)}</span>{/if}
				{#if show.runtime}<span class="chip">{formatRuntime(show.runtime)}</span>{/if}
			</p>
			{#if show.genres.length}
				<p class="genres">{show.genres.join(' · ')}</p>
			{/if}
			{#if show.maxProgress}
				<div class="overall">
					<div class="track"><div class="fill" style:width={`${pct(show.progress, show.maxProgress)}%`}></div></div>
					<span class="tnum">{show.progress}/{show.maxProgress}</span>
				</div>
			{/if}
		</div>
	</section>

	{#if show.synopsis}
		<p class="synopsis">{show.synopsis}</p>
	{/if}

	<section>
		<h2>Seasons</h2>
		<ul class="seasons">
			{#each seasons as s (s.seasonNumber)}
				<li>
					<a href="/show/{show.source}/{show.mediaId}/{s.seasonNumber}">
						<Poster src={s.poster} width={44} height={44} />
						<div class="s-meta">
							<span class="s-title">{s.seasonNumber === 0 ? 'Specials' : `Season ${s.seasonNumber}`}</span>
							<div class="s-progress">
								<div class="track">
									<div class="fill" style:width={`${pct(s.progress, s.maxProgress)}%`}></div>
								</div>
								<span class="tnum dim">
									{#if s.progress !== null && s.maxProgress}{s.progress}/{s.maxProgress}
									{:else if s.progress !== null}{s.progress} watched
									{:else}Not started{/if}
								</span>
							</div>
						</div>
						{#if s.maxProgress && s.progress === s.maxProgress}
							<svg class="done" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Complete">
								<path d="m5 13 4 4L19 7" />
							</svg>
						{:else}
							<svg class="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="m9 18 6-6-6-6" />
							</svg>
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	</section>

	{#if show.cast.length}
		<section>
			<h2>Cast</h2>
			<ul class="cast">
				{#each show.cast as person (person.name + (person.role ?? ''))}
					<li>
						<Poster src={person.image} width={78} height={78} radius={39} />
						<span class="name">{person.name}</span>
						{#if person.role}<span class="role">{person.role}</span>{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if show.studios.length}
		<p class="studios">{show.studios.join(' · ')}</p>
	{/if}
</main>

<style>
	main {
		padding: 0 var(--gutter) calc(var(--safe-b) + 32px);
	}

	.hero {
		display: grid;
		grid-template-columns: 104px 1fr;
		gap: 14px;
		margin: 8px 0 16px;
	}

	.facts {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 8px;
		min-width: 0;
	}
	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
	}
	.chip {
		padding: 3px 9px;
		border-radius: 7px;
		background: var(--surface-raised);
		font-size: 12px;
		color: var(--text-dim);
	}
	.genres {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.overall {
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.track {
		flex: 1;
		height: 5px;
		min-width: 40px;
		border-radius: 3px;
		background: var(--surface-raised);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		border-radius: 3px;
		background: var(--signal);
	}

	.synopsis {
		margin: 0 0 22px;
		font-size: 14.5px;
		line-height: 1.55;
	}

	section h2 {
		margin: 0 0 10px;
		font-size: 13px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	.seasons {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0 0 24px;
		padding: 0;
		list-style: none;
	}
	.seasons a {
		display: grid;
		grid-template-columns: 44px 1fr auto;
		align-items: center;
		gap: 12px;
		min-height: 60px;
		padding: 8px 12px 8px 8px;
		border-radius: var(--radius);
		background: var(--surface);
	}
	.s-meta {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.s-title {
		font-size: 15px;
		font-weight: 600;
	}
	.s-progress {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.dim {
		font-size: 11.5px;
		color: var(--text-dim);
		flex: none;
	}
	.done {
		color: var(--signal-solid);
	}
	.chev {
		color: var(--text-dim);
	}

	.cast {
		display: flex;
		gap: 12px;
		margin: 0 0 24px;
		padding: 0 var(--gutter) 4px 0;
		list-style: none;
		overflow-x: auto;
		scroll-snap-type: x proximity;
	}
	.cast li {
		flex: none;
		width: 78px;
		scroll-snap-align: start;
	}
	.cast :global(img),
	.cast :global(.ph) {
		margin-bottom: 6px;
	}
	.name {
		display: block;
		font-size: 12px;
		font-weight: 600;
		line-height: 1.3;
	}
	.role {
		display: block;
		font-size: 11px;
		color: var(--text-dim);
		line-height: 1.3;
	}

	.studios {
		margin: 0;
		font-size: 12px;
		color: var(--text-dim);
	}
</style>
