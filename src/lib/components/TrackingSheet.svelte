<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { STATUS_CHOICES, SCORE_MAX } from '$lib/tracking';
	import type { Tracking } from '$lib/tracking';

	/**
	 * Everything about your relationship with one show, in one place: where you
	 * are with it, what you thought of it, whether you watch it together, and
	 * whether you keep it at all.
	 *
	 * Deliberately one sheet rather than a menu of separate destinations —
	 * status and score are the two things most likely to be changed in the same
	 * sitting, and splitting them would mean opening two things to finish one
	 * thought.
	 */
	type Props = {
		title: string;
		tracking: Tracking;
		joint: boolean;
		/** Joint/solo is a show-level household tag; a film page has no use for it. */
		showJoint?: boolean;
		busy?: boolean;
		onstatus: (status: number) => void;
		onscore: (score: number | null) => void;
		onjoint: (joint: boolean) => void;
		onremove: () => void;
		onclose: () => void;
	};
	let {
		title,
		tracking,
		joint,
		showJoint = true,
		busy = false,
		onstatus,
		onscore,
		onjoint,
		onremove,
		onclose
	}: Props = $props();

	/* 1–10 rather than 0–10. Floppy accepts 0, but a zero rating and no rating
	   are indistinguishable to a reader, and "no rating" already has a control. */
	const SCORES = Array.from({ length: SCORE_MAX }, (_, i) => i + 1);
</script>

<Sheet label={title} {onclose} scrollable>
	<div class="pad">
		<h2>{title}</h2>

		<section>
			<h3>Status</h3>
			<div class="rows">
				{#each STATUS_CHOICES as choice (choice.value)}
					<button
						class:on={tracking.status === choice.value}
						disabled={busy}
						onclick={() => onstatus(choice.value)}
					>
						<span>{choice.label}</span>
						{#if tracking.status === choice.value}
							<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
						{/if}
					</button>
				{/each}
			</div>
		</section>

		<section>
			<div class="sechead">
				<h3>Your rating</h3>
				{#if tracking.score !== null}
					<button class="clear" disabled={busy} onclick={() => onscore(null)}>Clear</button>
				{/if}
			</div>
			<div class="scores">
				{#each SCORES as n (n)}
					<button
						class="score"
						class:on={tracking.score !== null && Math.round(tracking.score) === n}
						disabled={busy}
						aria-label={`Rate ${n} out of ${SCORE_MAX}`}
						onclick={() => onscore(n)}
					>{n}</button>
				{/each}
			</div>
		</section>

		{#if showJoint}
		<section>
			<h3>Watched</h3>
			<div class="rows">
				<button class:on={!joint} disabled={busy} onclick={() => onjoint(false)}>
					<span>Alone</span>
					{#if !joint}
						<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
					{/if}
				</button>
				<button class:on={joint} disabled={busy} onclick={() => onjoint(true)}>
					<span>Together</span>
					{#if joint}
						<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
					{/if}
				</button>
			</div>
		</section>
		{/if}

		<button class="remove" disabled={busy} onclick={onremove}>Remove from library</button>
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter) 4px; }
	h2 { margin: 0 0 18px; font-size: 18px; font-weight: 600; }
	section { margin-bottom: 22px; }
	h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
	.sechead { display: flex; align-items: baseline; justify-content: space-between; }
	.clear { font-size: 13px; font-weight: 600; color: var(--signal-solid); }

	.rows { display: flex; flex-direction: column; gap: 4px; }
	.rows button {
		display: flex; align-items: center; justify-content: space-between; gap: 12px;
		min-height: var(--tap); padding: 0 14px;
		border-radius: var(--radius); background: var(--surface-raised);
		font-size: 15px; color: var(--text); text-align: left;
	}
	.rows button.on { background: var(--signal); color: #fff; }

	/* A ten-wide row rather than a scroller: the whole scale has to be visible at
	   once or picking a rating means hunting for the number you want. */
	.scores { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
	.score {
		min-height: 40px; border-radius: 9px; background: var(--surface-raised);
		font-size: 13px; font-weight: 600; color: var(--text-dim);
		font-variant-numeric: tabular-nums;
	}
	.score.on { background: var(--signal); color: #fff; }

	.remove {
		width: 100%; min-height: var(--tap); border-radius: var(--radius);
		background: var(--surface-raised); color: #ff8a8a;
		font-size: 15px; font-weight: 600;
	}
	button:disabled { opacity: 0.5; }
</style>
