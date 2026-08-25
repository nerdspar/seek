<script lang="ts">
	/** Placeholder block for content that is still loading. Deliberately plain:
	 *  it is there to say "something is happening", not to be looked at. */
	type Props = { width?: string; height?: string; radius?: number; circle?: boolean };
	let { width = '100%', height = '16px', radius = 6, circle = false }: Props = $props();
</script>

<span
	class="sk"
	style:width
	style:height
	style:border-radius={circle ? '50%' : `${radius}px`}
	aria-hidden="true"
></span>

<style>
	.sk {
		display: block;
		flex: none;
		background: var(--surface);
		animation: breathe 1.5s ease-in-out infinite;
	}
	@keyframes breathe {
		50% {
			opacity: 0.45;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sk {
			animation: none;
			opacity: 0.7;
		}
	}
</style>
