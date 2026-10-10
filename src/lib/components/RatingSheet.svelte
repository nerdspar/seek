<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { SCORE_MAX } from '$lib/tracking';

	type Props = {
		title: string;
		score: number | null;
		busy?: boolean;
		onpick: (score: number | null) => void;
		onclose: () => void;
		/** Top of the scale: 10 for shows and films, 5 for books (BookOrbit). */
		max?: number;
	};
	let { title, score, busy = false, onpick, onclose, max = SCORE_MAX }: Props = $props();

	/* 1-10 rather than 0-10: a zero and no rating are
	   indistinguishable to a reader, and "no rating" already has its own control. */
	const SCORES = $derived(Array.from({ length: max }, (_, i) => i + 1));
</script>

<Sheet label={title} {onclose}>
	<div class="pad">
		<div class="head">
			<h2>Your rating</h2>
			{#if score !== null}
				<button class="clear" disabled={busy} onclick={() => onpick(null)}>Clear</button>
			{/if}
		</div>
		{#if max === 5}
			<!-- Books: a row of stars, filled up to your rating. -->
			<div class="stars" role="radiogroup" aria-label="Your rating">
				{#each SCORES as n (n)}
					<button
						role="radio"
						aria-checked={score === n}
						class:on={score !== null && n <= score}
						disabled={busy}
						aria-label={`${n} star${n === 1 ? '' : 's'}`}
						onclick={() => onpick(n)}
					>
						<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.85z" /></svg>
					</button>
				{/each}
			</div>
		{:else}
			<div class="scores">
				{#each SCORES as n (n)}
					<button
						class:on={score !== null && Math.round(score) === n}
						disabled={busy}
						aria-label={`Rate ${n} out of ${max}`}
						onclick={() => onpick(n)}
					>{n}</button>
				{/each}
			</div>
		{/if}
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter) 8px; }
	.head { display: flex; align-items: baseline; justify-content: space-between; }
	h2 { margin: 0 0 14px; font-size: 18px; font-weight: 600; }
	.clear { font-size: 14px; font-weight: 600; color: var(--signal-solid); }
	/* The whole scale visible at once — a scroller would mean hunting for a number. */
	.scores { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
	.scores button {
		min-height: 46px; border-radius: var(--radius); background: var(--surface-raised);
		font-size: 15px; font-weight: 600; color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}
	.scores button.on { background: var(--signal); color: #fff; }
	.stars { display: flex; justify-content: center; gap: 4px; padding: 4px 0 6px; }
	.stars button { display: grid; place-items: center; width: 56px; height: 56px; }
	.stars svg { fill: none; stroke: var(--text-dim); stroke-width: 1.6; stroke-linejoin: round; }
	.stars button.on svg { fill: var(--signal-solid); stroke: var(--signal-solid); }
	button:disabled { opacity: 0.5; }
</style>
