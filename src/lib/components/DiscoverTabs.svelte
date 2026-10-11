<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import type { MediaOn } from '$lib/media';

	/**
	 * The Discover header: the TV / Movies switch (books are discovered in the
	 * unified search, not here). Trailing slot = whatever actions the page passes.
	 *
	 * `onnav` lets the page clear its mood filter before navigating.
	 */
	type Active = 'tv' | 'movie';
	let {
		active,
		media,
		onnav = (href: string) => goto(href, { noScroll: true }),
		children
	}: { active: Active; media: MediaOn; onnav?: (href: string) => void; children?: Snippet } = $props();
</script>

<header>
	<div class="segments" role="tablist">
		{#if media.tv}
			<button role="tab" aria-selected={active === 'tv'} class:on={active === 'tv'} onclick={() => onnav('/discover?type=tv')}>TV Shows</button>
		{/if}
		{#if media.movie}
			<button role="tab" aria-selected={active === 'movie'} class:on={active === 'movie'} onclick={() => onnav('/discover?type=movie')}>Movies</button>
		{/if}
	</div>
	{#if children}
		<div class="actions">{@render children()}</div>
	{/if}
</header>
