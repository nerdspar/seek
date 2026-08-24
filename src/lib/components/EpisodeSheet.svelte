<script lang="ts">
	import type { EpisodeDetail } from '$lib/types';
	import { formatAirDate, formatRuntime, epLabel } from '$lib/format';

	type Props = {
		showTitle: string;
		source: string;
		mediaId: string;
		season: number;
		episode: number;
		/** Marking is owned by the parent so the underlying row updates too. */
		onmark: () => void;
		onclose: () => void;
		marking?: boolean;
	};
	let { showTitle, source, mediaId, season, episode, onmark, onclose, marking = false }: Props =
		$props();

	let data = $state<EpisodeDetail | null>(null);
	let failed = $state<string | null>(null);

	$effect(() => {
		const params = new URLSearchParams({
			source,
			mediaId,
			season: String(season),
			episode: String(episode)
		});
		let cancelled = false;
		fetch(`/api/episode?${params}`)
			.then(async (r) => {
				if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? `HTTP ${r.status}`);
				return r.json();
			})
			.then((d) => !cancelled && (data = d))
			.catch((e) => !cancelled && (failed = e instanceof Error ? e.message : String(e)));
		return () => {
			cancelled = true;
		};
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

<div
	class="scrim"
	role="button"
	tabindex="-1"
	aria-label="Close"
	onclick={onclose}
	onkeydown={(e) => e.key === 'Enter' && onclose()}
></div>

<div class="sheet" role="dialog" aria-modal="true" aria-label="{epLabel(season, episode)} details">
	<div class="grip"></div>

	{#if failed}
		<div class="pad">
			<h2>Couldn't load that episode</h2>
			<p class="dim">{failed}</p>
		</div>
	{:else if !data}
		<!-- Numbers are known before the fetch resolves, so the sheet opens with
		     its identity already correct and only the detail fills in. -->
		<div class="pad">
			<p class="eyebrow tnum">{epLabel(season, episode)}</p>
			<h2 class="skeleton-text">{showTitle}</h2>
			<div class="skeleton still"></div>
		</div>
	{:else}
		{#if data.still}
			<img class="still" src={data.still} alt="" />
		{/if}
		<div class="pad">
			<p class="eyebrow tnum">
				{showTitle} · {epLabel(data.seasonNumber, data.episodeNumber)}
			</p>
			<h2>{data.title}</h2>

			<p class="meta tnum">
				{#if data.airDate}<span>{formatAirDate(data.airDate)}</span>{/if}
				{#if data.runtime}<span>{formatRuntime(data.runtime)}</span>{/if}
				{#if data.plays > 0}
					<span class="watched">Watched{data.plays > 1 ? ` ×${data.plays}` : ''}</span>
				{/if}
			</p>

			{#if data.synopsis}<p class="synopsis">{data.synopsis}</p>{/if}

			<button class="mark" onclick={onmark} disabled={marking}>
				{#if marking}
					Marking…
				{:else}
					<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true">
						<path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" />
						<circle cx="12" cy="12" r="3.2" />
					</svg>
					{data.plays > 0 ? 'Mark watched again' : 'Mark as Watched'}
				{/if}
			</button>
		</div>
	{/if}
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: rgb(0 0 0 / 0.6);
		border: none;
		animation: fade 160ms ease;
	}
	@keyframes fade {
		from { opacity: 0; }
	}

	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 71;
		max-height: 88dvh;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding-bottom: calc(var(--safe-b) + 16px);
		background: var(--surface);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		animation: rise 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	@keyframes rise {
		from { transform: translateY(100%); }
	}

	.grip {
		position: sticky;
		top: 0;
		width: 36px;
		height: 4px;
		margin: 8px auto;
		border-radius: 2px;
		background: var(--surface-raised);
		z-index: 1;
	}

	.pad {
		padding: 4px var(--gutter) 0;
	}

	.still {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		background: var(--surface-raised);
	}

	.eyebrow {
		margin: 8px 0 2px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-dim);
	}

	h2 {
		margin: 0 0 10px;
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		margin: 0 0 14px;
		font-size: 13px;
		color: var(--text-dim);
	}
	.watched {
		color: var(--signal-solid);
		font-weight: 600;
	}

	.synopsis {
		margin: 0 0 18px;
		font-size: 14.5px;
		line-height: 1.55;
		color: var(--text);
	}

	.mark {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		min-height: 50px;
		border-radius: var(--radius);
		background: var(--signal);
		color: #fff;
		font-size: 16px;
		font-weight: 600;
	}
	.mark:disabled {
		opacity: 0.6;
	}

	.dim {
		color: var(--text-dim);
		font-size: 14px;
	}

	.skeleton {
		background: var(--surface-raised);
		border-radius: 8px;
	}
	.skeleton.still {
		width: 100%;
		aspect-ratio: 16 / 9;
		margin: 12px 0;
	}
	.skeleton-text {
		color: var(--text-dim);
	}
</style>
