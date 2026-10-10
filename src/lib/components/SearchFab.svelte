<script lang="ts">
	import { goto } from '$app/navigation';

	/**
	 * The one way to search Seek, from any tab: a floating button that opens the
	 * universal search (your list first, then TMDB). Same spot, same action on
	 * every page. `hidden` slides it away when something else owns the bottom —
	 * the watchlist's undo toast — so the two never stack.
	 */
	let { hidden = false }: { hidden?: boolean } = $props();
</script>

<button class="fab" class:hidden onclick={() => goto('/search')} aria-label="Search">
	<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.6-3.6" /></svg>
</button>

<style>
	.fab {
		position: fixed;
		right: var(--gutter);
		bottom: calc(var(--tabbar-h) + var(--tabbar-safe-b) + 16px);
		z-index: 40;
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--signal);
		color: #fff;
		box-shadow: 0 8px 24px color-mix(in srgb, var(--signal-solid) 34%, transparent);
		transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease;
	}
	.fab.hidden {
		transform: translateY(calc(100% + var(--tabbar-h) + 24px));
		opacity: 0;
		pointer-events: none;
	}
</style>
