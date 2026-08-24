<script lang="ts">
	import type { MarkDirection } from '$lib/settings';

	type Props = {
		markDirection: MarkDirection;
		onchange: (d: MarkDirection) => void;
		onclose: () => void;
	};
	let { markDirection, onchange, onclose }: Props = $props();

	const OPTIONS: { id: MarkDirection; label: string; hint: string }[] = [
		{ id: 'rtl', label: 'Right to left', hint: 'Swipe leftward across the row' },
		{ id: 'ltr', label: 'Left to right', hint: 'Swipe rightward across the row' }
	];

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

<div
	class="scrim"
	role="button"
	tabindex="-1"
	aria-label="Close settings"
	onclick={onclose}
	onkeydown={(e) => e.key === 'Enter' && onclose()}
></div>

<div class="sheet" role="dialog" aria-modal="true" aria-label="Settings">
	<div class="grip"></div>
	<h2>Settings</h2>

	<section>
		<h3>Swipe to mark watched</h3>
		<div class="choices">
			{#each OPTIONS as opt (opt.id)}
				<button
					class:selected={markDirection === opt.id}
					aria-pressed={markDirection === opt.id}
					onclick={() => onchange(opt.id)}
				>
					<span class="label">{opt.label}</span>
					<span class="hint">{opt.hint}</span>
				</button>
			{/each}
		</div>
	</section>

	<p class="note">
		Sort, filters, theme and the link to Floppy's own settings arrive with the Profile tab.
	</p>

	<button class="done" onclick={onclose}>Done</button>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: rgb(0 0 0 / 0.55);
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
		padding: 8px var(--gutter) calc(var(--safe-b) + 16px);
		background: var(--surface);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		animation: rise 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	@keyframes rise {
		from { transform: translateY(100%); }
	}

	.grip {
		width: 36px;
		height: 4px;
		margin: 4px auto 12px;
		border-radius: 2px;
		background: var(--surface-raised);
	}

	h2 {
		margin: 0 0 18px;
		font-size: 18px;
		font-weight: 600;
	}
	h3 {
		margin: 0 0 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-dim);
	}

	.choices {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.choices button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-height: var(--tap);
		padding: 9px 14px;
		border-radius: var(--radius);
		background: var(--surface-raised);
		text-align: left;
	}
	.choices button.selected {
		background: var(--signal);
		color: #fff;
	}
	.label {
		font-size: 15px;
		font-weight: 600;
	}
	.hint {
		font-size: 12px;
		opacity: 0.7;
	}

	.note {
		margin: 18px 0 0;
		font-size: 12px;
		line-height: 1.5;
		color: var(--text-dim);
	}

	.done {
		width: 100%;
		min-height: var(--tap);
		margin-top: 16px;
		border-radius: var(--radius);
		background: var(--surface-raised);
		font-size: 15px;
		font-weight: 600;
	}
</style>
