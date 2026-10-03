<script lang="ts">
	/** At-a-glance state of a connection: set up, half set up, not set up, or
	 *  failing its last test. Shape *and* colour differ, so it never relies on
	 *  colour alone. */
	export type DotState = 'ok' | 'partial' | 'off' | 'bad';
	let { state }: { state: DotState } = $props();
	const LABEL: Record<DotState, string> = {
		ok: 'Set up',
		partial: 'Incomplete',
		off: 'Not set up',
		bad: 'Not working'
	};
</script>

<span class="dot {state}" role="img" aria-label={LABEL[state]} title={LABEL[state]}>
	{#if state === 'ok'}
		<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
	{:else if state === 'partial' || state === 'bad'}
		<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M8 3.5v5.5M8 12.2v.1" /></svg>
	{/if}
</span>

<style>
	.dot {
		flex: none; display: inline-grid; place-items: center;
		width: 20px; height: 20px; border-radius: 50%;
	}
	.ok { background: color-mix(in srgb, var(--signal-solid) 22%, transparent); color: var(--signal-solid); }
	.partial { background: color-mix(in srgb, #f5b84a 22%, transparent); color: #f5b84a; }
	.bad { background: color-mix(in srgb, #ff8a8a 22%, transparent); color: #ff8a8a; }
	.off { box-shadow: inset 0 0 0 1.5px var(--text-dim); opacity: 0.55; }
</style>
