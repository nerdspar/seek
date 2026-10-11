<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import type { MediaOn } from '$lib/media';

	/**
	 * The Discover header: the TV / Movies / Books switch, so each kind's curated
	 * shelves read the same way. Trailing slot = whatever actions the page passes.
	 *
	 * `onnav` lets the TV/Movies page clear its mood filter before navigating.
	 */
	type Active = 'tv' | 'movie' | 'books';
	let {
		active,
		media,
		books,
		onnav = (href: string) => goto(href, { noScroll: true }),
		children
	}: { active: Active; media: MediaOn; books: boolean; onnav?: (href: string) => void; children?: Snippet } = $props();
</script>

<header>
	<div class="segments" role="tablist">
		{#if media.tv}
			<button role="tab" aria-selected={active === 'tv'} class:on={active === 'tv'} onclick={() => onnav('/discover?type=tv')}>TV Shows</button>
		{/if}
		{#if media.movie}
			<button role="tab" aria-selected={active === 'movie'} class:on={active === 'movie'} onclick={() => onnav('/discover?type=movie')}>Movies</button>
		{/if}
		{#if books}
			<button role="tab" aria-selected={active === 'books'} class:on={active === 'books'} onclick={() => onnav('/discover/books')}>Books</button>
		{/if}
	</div>
	{#if children}
		<div class="actions">{@render children()}</div>
	{/if}
</header>
