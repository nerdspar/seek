<script lang="ts">
	import Poster from './Poster.svelte';
	import BookTileButtons from './BookTileButtons.svelte';
	import { coverThumb, cardBadge, type BookReadStatus, type DiscoveryCard } from '$lib/books';

	/** One horizontal shelf of book covers (Discover → Books). Books you already
	 *  own carry a small badge with your status; each cover has + (want to read)
	 *  and download, like a show's. */
	type Card = DiscoveryCard;
	type Props = {
		title: string;
		subtitle?: string | null;
		books: Card[];
		/** Statuses changed on this screen, shown before the page reloads. */
		overrides?: Record<number, BookReadStatus>;
		canDownload?: boolean;
		onopen: (book: Card) => void;
		onadd: (book: Card) => void;
		ondownload: (book: Card) => void;
	};
	let { title, subtitle = null, books, overrides = {}, canDownload = false, onopen, onadd, ondownload }: Props = $props();
	const shown = $derived(books.map((b) => (overrides[b.hardcoverId] ? { ...b, mine: overrides[b.hardcoverId] } : b)));
</script>

<section class="shelf">
	<h2>{title}</h2>
	{#if subtitle}<p class="why">{subtitle}</p>{/if}
	<ul class="rail">
		{#each shown as b (b.hardcoverId)}
			<li>
				<div class="cover">
					<button class="tile" onclick={() => onopen(b)}>
						<Poster src={coverThumb(b.coverUrl, 110)} width={110} height={165} radius={8} />
						{#if cardBadge(b)}<span class="owned">{cardBadge(b)}</span>{/if}
					</button>
					<BookTileButtons card={b} {canDownload} {onadd} {ondownload} />
				</div>
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
	.cover { position: relative; width: 110px; }
	.tile { position: relative; display: block; width: 110px; }
	.owned {
		position: absolute; left: 5px; bottom: 5px; max-width: calc(100% - 46px);
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
