<script lang="ts">
	/** Poster/still with a graceful fallback. An image URL can still fail to
	 *  load, and a plain <img> then renders the browser's broken-image glyph.
	 *  This degrades to the same neutral block as a null src. */
	type Props = {
		src: string | null;
		alt?: string;
		width: number;
		height: number;
		radius?: number;
		eager?: boolean;
	};
	let { src, alt = '', width, height, radius = 8, eager = false }: Props = $props();

	let broken = $state(false);
	// A new src deserves a fresh attempt.
	$effect(() => {
		src;
		broken = false;
	});
</script>

{#if src && !broken}
	<img
		{src}
		{alt}
		style:width={`${width}px`}
		style:height={`${height}px`}
		style:border-radius={`${radius}px`}
		loading={eager ? 'eager' : 'lazy'}
		decoding="async"
		onerror={() => (broken = true)}
	/>
{:else}
	<div
		class="ph"
		style:width={`${width}px`}
		style:height={`${height}px`}
		style:border-radius={`${radius}px`}
		aria-hidden="true"
	></div>
{/if}

<style>
	img {
		object-fit: cover;
		background: var(--surface-raised);
		flex: none;
	}
	.ph {
		background: var(--surface-raised);
		flex: none;
	}
</style>
