<script lang="ts">
	import Poster from './Poster.svelte';
	import { coverThumb, progressText, statusLabel, type MyBook } from '$lib/books';

	/** One book on the reading list: cover, title, author, where you are in it
	 *  ("123 / 400 pages · 31%") and your rating. `note` replaces the status line
	 *  (a requested book shows where its download is). */
	type Props = { book: MyBook; note?: string | null; onopen: (b: MyBook) => void };
	let { book, note = null, onopen }: Props = $props();
	const progress = $derived(book.status !== 'read' ? progressText(book) : null);
</script>

<button class="row" onclick={() => onopen(book)}>
	<Poster src={coverThumb(book.coverUrl, 52)} width={52} height={78} radius={6} />
	<span class="text">
		<span class="title">{book.title}</span>
		{#if book.authors.length}<span class="by">{book.authors.join(', ')}</span>{/if}
		{#if book.seriesName}
			<span class="series">{book.seriesName}{book.seriesIndex ? ` · ${book.seriesIndex}` : ''}</span>
		{/if}
		{#if note}
			<span class="status">{note}</span>
		{:else if progress && book.progress !== null && book.progress > 0}
			<span class="progress">
				<span class="track"><span class="fill" style:width={`${Math.round(book.progress * 100)}%`}></span></span>
				<span class="pct tnum">{progress}</span>
			</span>
		{:else}
			<span class="status">
				{statusLabel(book.status)}{#if book.myRating}<span class="stars" aria-label={`Rated ${book.myRating} of 5`}> · {'★'.repeat(book.myRating)}</span>{/if}
			</span>
		{/if}
	</span>
</button>

<style>
	.row {
		display: flex; align-items: center; gap: 12px; width: 100%;
		padding: 10px 12px; border-radius: 14px; background: var(--surface);
		text-align: left;
	}
	.text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.title {
		font-size: 15px; font-weight: 600; line-height: 1.3;
		display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
		-webkit-box-orient: vertical; overflow: hidden;
	}
	.by, .series { font-size: 12.5px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.status { margin-top: 4px; font-size: 12px; font-weight: 600; color: var(--text-dim); }
	.stars { color: var(--signal-solid); letter-spacing: 1px; }
	.progress { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
	.track { flex: 1; height: 5px; border-radius: 3px; background: var(--surface-raised); overflow: hidden; }
	.fill { display: block; height: 100%; border-radius: 3px; background: var(--signal); }
	.pct { flex: none; font-size: 11.5px; color: var(--text-dim); }
</style>
