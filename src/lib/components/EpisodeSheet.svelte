<script lang="ts">
	import Sheet from './Sheet.svelte';
	import type { EpisodeDetail } from '$lib/types';
	import type { DlState } from '$lib/arrClient';
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
		/** Download state + actions, when the show is managed in Sonarr. Omitted on
		 *  surfaces (e.g. the watchlist) that don't manage downloads. */
		arrState?: DlState;
		onsearch?: () => void;
		oninteractive?: () => void;
		onfile?: () => void;
	};
	let {
		showTitle,
		source,
		mediaId,
		season,
		episode,
		onmark,
		onclose,
		marking = false,
		arrState,
		onsearch,
		oninteractive,
		onfile
	}: Props = $props();

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
</script>

<Sheet label={`${epLabel(season, episode)} details`} {onclose} scrollable>
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

			{#if arrState && arrState !== 'unknown'}
				<div class="arr">
					{#if arrState === 'have'}
						<button class="arr-btn" onclick={() => onfile?.()}>
							<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
							Downloaded · manage file
						</button>
					{:else if arrState === 'downloading'}
						<p class="arr-note"><span class="spin" aria-hidden="true"></span> Downloading…</p>
					{:else if arrState === 'unaired'}
						<p class="arr-note">Not aired yet — Sonarr will grab it when it airs.</p>
					{:else}
						<div class="arr-row">
							<button class="arr-btn" onclick={() => onsearch?.()}>
								<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
								Search
							</button>
							<button class="arr-btn" onclick={() => oninteractive?.()}>
								<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.4" /><path d="M4.5 19a5.5 5.5 0 0 1 9.7-3.2" /><circle cx="17.5" cy="16.5" r="2.6" /><path d="m21 20-1.7-1.7" /></svg>
								Interactive
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</Sheet>

<style>
	.pad {
		padding: 0 var(--gutter);
	}

	.still {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		background: var(--surface-raised);
		margin-bottom: 4px;
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

	.arr { margin-top: 10px; }
	.arr-row { display: flex; gap: 8px; }
	.arr-btn {
		flex: 1;
		display: flex; align-items: center; justify-content: center; gap: 8px;
		min-height: 46px; border-radius: var(--radius);
		background: var(--surface-raised); color: var(--text);
		font-size: 14px; font-weight: 600;
	}
	.arr-note { display: flex; align-items: center; gap: 8px; margin: 2px 0; font-size: 13px; color: var(--text-dim); }
	.spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--surface-raised); border-top-color: #ffb545; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

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
