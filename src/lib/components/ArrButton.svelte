<script lang="ts">
	import { arrConfigured, inArr, arrServiceName } from '$lib/arr.svelte';

	/**
	 * The "send this to Sonarr/Radarr" trigger for a browse tile or a detail page.
	 *
	 * Deliberately dumb: it renders the affordance and its added/not-added state,
	 * and delegates the actual choice (add & search vs. monitor only) upward via
	 * `onadd`. The choice sheet is owned by the page and rendered once at top
	 * level — a dialog nested inside a tile's own <button> would be invalid markup.
	 */
	type Item = { mediaType: string; tmdbId: string; title: string };
	type Props = {
		mediaType: string;
		tmdbId: string;
		title: string;
		onadd: (item: Item) => void;
		/** Compact circular form for poster tiles; otherwise a labelled pill. */
		compact?: boolean;
		size?: number;
	};
	let { mediaType, tmdbId, title, onadd, compact = false, size = 32 }: Props = $props();

	const configured = $derived(arrConfigured(mediaType));
	const added = $derived(inArr(mediaType, tmdbId));
	const service = $derived(arrServiceName(mediaType));

	function click(e: MouseEvent) {
		e.stopPropagation();
		if (added) return;
		onadd({ mediaType, tmdbId, title });
	}
</script>

{#if configured}
	{#if compact}
		<button
			class="chip"
			class:added
			style:width={`${size}px`}
			style:height={`${size}px`}
			aria-label={added ? `In ${service}` : `Add ${title} to ${service}`}
			title={added ? `In ${service}` : `Add to ${service}`}
			onclick={click}
		>
			{#if added}
				<svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
			{:else}
				<!-- down-into-tray: "grab this" -->
				<svg viewBox="0 0 24 24" width={size * 0.52} height={size * 0.52} fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
			{/if}
		</button>
	{:else}
		<button class="pill" class:added onclick={click} disabled={added}>
			{#if added}
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
				<span>In {service}</span>
			{:else}
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
				<span>Add to {service}</span>
			{/if}
		</button>
	{/if}
{/if}

<style>
	.chip {
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	.chip.added {
		background: var(--good, #2ea043);
		color: #fff;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: var(--tap);
		padding: 0 16px;
		border-radius: 12px;
		background: var(--surface-raised);
		color: var(--text);
		font-size: 15px;
		font-weight: 600;
	}
	.pill.added {
		color: var(--text-dim);
	}
	.pill:disabled {
		opacity: 0.75;
	}
</style>
