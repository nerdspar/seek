<script lang="ts">
	import Sheet from './Sheet.svelte';
	/** Deliberately keyed on plain strings: the watchlist and the collection views
	 *  offer different orderings, and neither should have to know the other's. */
	type Props = {
		current: string;
		options: { key: string; label: string }[];
		onchange: (key: string) => void;
		onclose: () => void;
	};
	let { current, options, onchange, onclose }: Props = $props();
</script>

<Sheet label="Sort" {onclose}>
	<div class="pad">
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
</Sheet>

<style>
	.pad { padding: 0 var(--gutter); }
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
