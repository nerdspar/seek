<script lang="ts">
	import Poster from './Poster.svelte';
	import { coverThumb, cardBadge, type BookCard, type ReadingBook } from '$lib/books';

	/** One horizontal shelf of book covers (Discover → Books). Books you already
	 *  own carry a small badge with your status. */
	type Owned = { bookId: number; status: ReadingBook['status']; progress: number | null };
	type Card = BookCard & { owned?: Owned | null; wished?: boolean };
	type Props = { title: string; subtitle?: string | null; books: Card[]; onopen: (book: Card) => void };
	let { title, subtitle = null, books, onopen }: Props = $props();
</script>

<section class="shelf">
	<h2>{title}</h2>
	{#if subtitle}<p class="why">{subtitle}</p>{/if}
	<ul class="rail">
		{#each books as b (b.hardcoverId)}
			<li>
				<button class="tile" onclick={() => onopen(b)}>
					<Poster src={coverThumb(b.coverUrl, 110)} width={110} height={165} radius={8} />
					{#if cardBadge(b)}<span class="owned">{cardBadge(b)}</span>{/if}
				</button>
				<span class="cap">{b.title}</span>
				<span class="sub tnum">{[b.author, b.year].filter(Boolean).join(' · ')}</span>
			</li>
		{/each}
	</ul>
</section>

<style>
	.shelf { margin-bottom: 26px; }
	.shelf h2 { margin: 0 var(--gutter) 2px; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
	.why { margin: 0 var(--gutter) 8px; font-size: 12.5px; color: var(--text-dim); }
	.rail {
		display: flex; gap: 12px; overflow-x: auto; margin: 8px 0 0; list-style: none;
		padding: 0 var(--gutter) 4px;
		scroll-snap-type: x proximity;
		scroll-padding-left: var(--gutter);
	}
	.rail li { flex: none; width: 110px; scroll-snap-align: start; }
	.tile { position: relative; display: block; width: 110px; }
	.owned {
		position: absolute; left: 5px; bottom: 5px; max-width: calc(100% - 10px);
		padding: 3px 7px; border-radius: 6px;
		background: color-mix(in srgb, var(--bg) 82%, transparent);
		backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
		font-size: 10.5px; font-weight: 700; color: var(--text);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.cap {
		display: block; margin-top: 6px; font-size: 12.5px; font-weight: 600;
		line-height: 1.3; overflow: hidden; display: -webkit-box;
		-webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
	}
	.sub {
		display: block; font-size: 11px; color: var(--text-dim);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
</style>
