<script lang="ts">
	import type { DlState } from '$lib/arrClient';

	/**
	 * The download affordance for one episode row — the piece that sits beside the
	 * watched circle. Purely presentational: the page owns the data and the
	 * actions. States: have it (teal check, tap for file actions), downloading
	 * (spinner + %), missing (magnifier = automatic search, person = interactive),
	 * or nothing when the episode isn't in Sonarr.
	 */
	type Props = {
		state: DlState;
		percent?: number;
		label: string;
		onauto: () => void;
		oninteractive: () => void;
		onfile: () => void;
	};
	let { state, percent = 0, label, onauto, oninteractive, onfile }: Props = $props();
</script>

{#if state === 'have'}
	<button class="glyph have" aria-label={`Downloaded — manage file for ${label}`} onclick={onfile}>
		<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
	</button>
{:else if state === 'downloading'}
	<span class="glyph dl" aria-label={`Downloading ${label} — ${percent}%`}>
		<svg class="spin" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
		<span class="pct tnum">{percent}%</span>
	</span>
{:else if state === 'missing'}
	<span class="actions">
		<button class="icon" aria-label={`Search for ${label}`} onclick={onauto}>
			<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
		</button>
		<button class="icon" aria-label={`Interactive search for ${label}`} onclick={oninteractive}>
			<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.4" /><path d="M4.5 19a5.5 5.5 0 0 1 9.7-3.2" /><circle cx="17.5" cy="16.5" r="2.6" /><path d="m21 20-1.7-1.7" /></svg>
		</button>
	</span>
{/if}

<style>
	.glyph {
		display: inline-grid; place-items: center;
		width: 34px; height: 34px; justify-self: center;
	}
	.glyph.have { color: #4fd6b8; }
	.glyph.dl { color: #ffb545; position: relative; flex-direction: column; }
	.pct { font-size: 9px; font-weight: 700; margin-top: -2px; }
	.spin { animation: spin 0.9s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.actions { display: inline-flex; align-items: center; gap: 4px; }
	.icon {
		display: grid; place-items: center;
		width: 34px; height: 34px; border-radius: 50%;
		background: var(--surface-raised); color: var(--text-dim);
	}
	.icon:active { transform: scale(0.92); }
</style>
