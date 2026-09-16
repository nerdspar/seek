<script lang="ts">
	import '../app.css';
	import NavProgress from '$lib/components/NavProgress.svelte';
	import { notice, dismissNotice } from '$lib/notices.svelte';
	import { pendingCount } from '$lib/queue.svelte';
	let { children } = $props();

	/* Un-synced writes, waiting for a connection. Silent at zero, which is the
	   normal case — this only appears when something is genuinely parked. */
	const pending = $derived(pendingCount());
</script>

<NavProgress />
{@render children()}

{#if pending > 0}
	<div class="pending" role="status" aria-label={`${pending} change${pending === 1 ? '' : 's'} waiting to sync`}>
		<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v5h-5" /></svg>
		<span class="tnum">{pending}</span>
	</div>
{/if}

<!-- One host for every confirmation, so a toast survives the navigation that
     sometimes follows the action that raised it. -->
{#if notice.current}
	{#key notice.current.id}
		<!-- A button, not a div with a click handler: it is dismissible, so it
		     should be reachable and announce itself as such. -->
		<button class="notice" onclick={dismissNotice}>{notice.current.message}</button>
	{/key}
{/if}

<style>
	.notice {
		position: fixed;
		border: none;
		left: 50%;
		bottom: calc(var(--tabbar-h) + var(--safe-b) + 16px);
		transform: translateX(-50%);
		z-index: 60;
		max-width: calc(100% - var(--gutter) * 2);
		padding: 10px 16px;
		border-radius: 999px;
		background: var(--surface-raised);
		box-shadow: var(--shadow-lg);
		font-size: 13.5px;
		font-weight: 600;
		color: var(--text);
		animation: rise 180ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	@keyframes rise {
		from { opacity: 0; transform: translate(-50%, 8px); }
		to { opacity: 1; transform: translate(-50%, 0); }
	}
	@media (prefers-reduced-motion: reduce) {
		.notice { animation: none; }
	}

	/* Quiet by design: a small pill, not an alarm. Parked writes are the normal
	   consequence of marking something with no signal, not an error. */
	.pending {
		position: fixed;
		left: var(--gutter);
		bottom: calc(var(--tabbar-h) + var(--safe-b) + 16px);
		z-index: 55;
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 6px 10px;
		border-radius: 999px;
		background: var(--surface-raised);
		box-shadow: var(--shadow-lg);
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-dim);
	}
	.pending svg { animation: spin 1.4s linear infinite; }
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	@media (prefers-reduced-motion: reduce) {
		.pending svg { animation: none; }
	}
</style>
