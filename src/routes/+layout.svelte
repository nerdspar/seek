<script lang="ts">
	import '../app.css';
	import NavProgress from '$lib/components/NavProgress.svelte';
	import { notice, dismissNotice } from '$lib/notices.svelte';
	let { children } = $props();
</script>

<NavProgress />
{@render children()}

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
</style>
