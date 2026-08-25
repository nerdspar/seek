<script lang="ts">
	import type { SortKey } from '$lib/server/prefs';

	type Props = {
		current: SortKey;
		options: { key: SortKey; label: string }[];
		onchange: (key: SortKey) => void;
		onclose: () => void;
	};
	let { current, options, onchange, onclose }: Props = $props();

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

<div class="sheet" role="dialog" aria-modal="true" aria-label="Sort">
	<div class="grip"></div>
	<h2>Sort by</h2>
	<ul>
		{#each options as opt (opt.key)}
			<li>
				<button
					class:on={current === opt.key}
					aria-pressed={current === opt.key}
					onclick={() => onchange(opt.key)}
				>
					<span>{opt.label}</span>
					{#if current === opt.key}
						<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
</div>

<style>
	.scrim {
		position: fixed; inset: 0; z-index: 70;
		background: rgb(0 0 0 / 0.55); border: none;
		animation: fade 160ms ease;
	}
	@keyframes fade { from { opacity: 0; } }

	.sheet {
		position: fixed; left: 0; right: 0; bottom: 0; z-index: 71;
		padding: 8px var(--gutter) calc(var(--safe-b) + 16px);
		background: var(--surface);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		animation: rise 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	@keyframes rise { from { transform: translateY(100%); } }

	.grip {
		width: 36px; height: 4px; margin: 4px auto 12px;
		border-radius: 2px; background: var(--surface-raised);
	}
	h2 { margin: 0 0 12px; font-size: 18px; font-weight: 600; }

	ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
	li button {
		display: flex; align-items: center; justify-content: space-between; gap: 12px;
		width: 100%; min-height: var(--tap); padding: 0 14px;
		border-radius: var(--radius); background: var(--surface-raised);
		font-size: 15px; text-align: left;
	}
	li button.on { background: var(--signal); color: #fff; font-weight: 600; }
</style>
