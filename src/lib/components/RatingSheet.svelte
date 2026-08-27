<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { SCORE_MAX } from '$lib/tracking';

	type Props = {
		title: string;
		score: number | null;
		busy?: boolean;
		onpick: (score: number | null) => void;
		onclose: () => void;
	};
	let { title, score, busy = false, onpick, onclose }: Props = $props();

	/* 1-10 rather than 0-10. Floppy accepts 0, but a zero and no rating are
	   indistinguishable to a reader, and "no rating" already has its own control. */
	const SCORES = Array.from({ length: SCORE_MAX }, (_, i) => i + 1);
</script>

<Sheet label={title} {onclose}>
	<div class="pad">
		<div class="head">
			<h2>Your rating</h2>
			{#if score !== null}
				<button class="clear" disabled={busy} onclick={() => onpick(null)}>Clear</button>
			{/if}
		</div>
		<div class="scores">
			{#each SCORES as n (n)}
				<button
					class:on={score !== null && Math.round(score) === n}
					disabled={busy}
					aria-label={`Rate ${n} out of ${SCORE_MAX}`}
					onclick={() => onpick(n)}
				>{n}</button>
			{/each}
		</div>
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
	button:disabled { opacity: 0.5; }
</style>
