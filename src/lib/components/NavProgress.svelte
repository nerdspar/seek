<script lang="ts">
	import { navigating } from '$app/state';

	/* A tap that does nothing for a second reads as a broken tap target, which is
	   exactly how the Profile tab felt. Even with the loads cached, some navigation
	   still crosses the network, so it should always be visibly acknowledged.
	   Delayed slightly so genuinely fast navigations don't flash a bar. */
	let visible = $state(false);

	$effect(() => {
		if (!navigating.to) {
			visible = false;
			return;
		}
		const timer = setTimeout(() => (visible = true), 120);
		return () => clearTimeout(timer);
	});
</script>

{#if visible}
	<div class="bar" role="progressbar" aria-label="Loading"></div>
{/if}

<style>
	.bar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		z-index: 90;
		background: var(--signal);
		transform-origin: left;
		animation: crawl 8s cubic-bezier(0.1, 0.8, 0.2, 1) forwards;
	}
	/* Approaches 100% without ever arriving — the bar is honest about not
	   knowing how long the server will take. */
	@keyframes crawl {
		0% { transform: scaleX(0.05); }
		40% { transform: scaleX(0.6); }
		100% { transform: scaleX(0.95); }
	}
</style>
