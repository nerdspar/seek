<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Snippet } from 'svelte';
	import type { MediaOn } from '$lib/media';

	/**
	 * The Discover header, shared by the TV/Movies page and the Books page so the
	 * tabs are defined once and can't drift apart. Leading slot = the TV / Movies
	 * / Books switch; trailing = whatever actions the page passes.
	 *
	 * `onnav` lets the TV/Movies page clear its mood filter before navigating;
	 * the Books page takes the plain default.
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
