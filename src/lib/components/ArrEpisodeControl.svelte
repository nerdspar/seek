<script lang="ts">
	import type { DlState } from '$lib/arrClient';

	/**
	 * The download *status* for one episode row — a quiet indicator beside the
	 * watched circle, not an action. Tapping the row opens the episode overlay,
	 * which is where searching / file actions now live. States: have it (teal
	 * check), downloading (spinner + %), unaired (clock), missing (hollow
	 * download), or nothing when the episode isn't in Sonarr.
	 */
	type Props = { state: DlState; percent?: number; label: string };
	let { state, percent = 0, label }: Props = $props();

	const title = $derived<Record<DlState, string>>({
		have: 'Downloaded',
		downloading: `Downloading ${percent}%`,
		unaired: 'Not aired yet',
		missing: 'Missing',
		unknown: ''
	});
</script>

{#if state !== 'unknown'}
	<span class="glyph {state}" aria-label={`${title[state]} — ${label}`} title={title[state]}>
		{#if state === 'have'}
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
		{:else if state === 'downloading'}
			<svg class="spin" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
			<span class="pct tnum">{percent}%</span>
		{:else if state === 'unaired'}
			<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
		{:else if state === 'missing'}
			<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5" stroke-dasharray="2.6 2.8" /><path d="M12 8.5v5m0 0 2-2m-2 2-2-2" /></svg>
		{/if}
	</span>
{/if}

<style>
	.glyph {
		display: inline-grid; place-items: center;
		width: 34px; height: 34px; justify-self: center;
	}
	.glyph.have { color: #4fd6b8; }
	.glyph.downloading { color: #ffb545; grid-auto-flow: row; }
	.glyph.unaired { color: var(--text-dim); opacity: 0.8; }
	.glyph.missing { color: var(--text-dim); }
	.pct { font-size: 9px; font-weight: 700; margin-top: -2px; }
	.spin { animation: spin 0.9s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
