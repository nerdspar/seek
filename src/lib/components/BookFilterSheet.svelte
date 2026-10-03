<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { NO_BOOK_FILTERS, type BookFilters } from '$lib/books';

	/** Narrow the reading list: by status, by kind (ebook / audiobook in your
	 *  library, or your own books outside it), by one of your shelves, by genre.
	 *  Shelves are managed from here too — they're how you group books. */
	type Props = {
		filters: BookFilters;
		genres: string[];
		/** How many books the current filters match. */
		resultCount: number;
		onchange: (f: BookFilters) => void;
		onmanage: () => void;
		onclose: () => void;
	};
	let { filters, genres, resultCount, onchange, onmanage, onclose }: Props = $props();

	const STATUS: { id: BookFilters['status']; label: string }[] = [
		{ id: 'all', label: 'All' },
		{ id: 'reading', label: 'Reading' },
		{ id: 'want_to_read', label: 'Want to read' },
		{ id: 'read', label: 'Read' },
		{ id: 'on_hold', label: 'On hold' },
		{ id: 'abandoned', label: 'Did not finish' },
		{ id: 'unstarted', label: 'Not started' }
	];
	const KIND: { id: BookFilters['kind']; label: string }[] = [
		{ id: 'all', label: 'All' },
		{ id: 'ebook', label: 'Ebook' },
		{ id: 'audiobook', label: 'Audiobook' },
		{ id: 'mine', label: 'Not in library' }
	];

	type Shelf = { id: number; name: string; count: number };
	let shelves = $state<Shelf[]>([]);
	$effect(() => {
		fetch('/api/books/shelves')
			.then((r) => (r.ok ? r.json() : { shelves: [] }))
			.then((b) => (shelves = b.shelves ?? []))
			.catch(() => {});
	});

	const set = (patch: Partial<BookFilters>) => onchange({ ...filters, ...patch });
</script>

<Sheet label="Filter books" {onclose} scrollable>
	<div class="pad">
		<div class="head">
			<h2>Filter</h2>
			<button class="reset" onclick={() => onchange(NO_BOOK_FILTERS)}>Reset</button>
		</div>

		<h3>Status</h3>
		<div class="chips">
			{#each STATUS as s (s.id)}
				<button class:on={filters.status === s.id} aria-pressed={filters.status === s.id} onclick={() => set({ status: s.id })}>{s.label}</button>
			{/each}
		</div>

		<h3>Kind</h3>
		<div class="chips">
			{#each KIND as k (k.id)}
				<button class:on={filters.kind === k.id} aria-pressed={filters.kind === k.id} onclick={() => set({ kind: k.id })}>{k.label}</button>
			{/each}
		</div>

		<div class="subhead">
			<h3>Shelf</h3>
			<button class="manage" onclick={onmanage}>Manage shelves</button>
		</div>
		<div class="chips">
			<button class:on={filters.shelf === null} onclick={() => set({ shelf: null })}>Any</button>
			{#each shelves as sh (sh.id)}
				<button class:on={filters.shelf === sh.id} aria-pressed={filters.shelf === sh.id} onclick={() => set({ shelf: sh.id })}>
					{sh.name} <span class="n tnum">{sh.count}</span>
				</button>
			{/each}
			{#if !shelves.length}<span class="none">No shelves yet.</span>{/if}
		</div>

		{#if genres.length}
			<h3>Genre</h3>
			<div class="chips">
				<button class:on={filters.genre === null} onclick={() => set({ genre: null })}>Any</button>
				{#each genres as g (g)}
					<button class:on={filters.genre === g} aria-pressed={filters.genre === g} onclick={() => set({ genre: g })}>{g}</button>
				{/each}
			</div>
		{/if}

		<button class="done" onclick={onclose}>Show {resultCount} {resultCount === 1 ? 'book' : 'books'}</button>
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter) 12px; }
	.head { display: flex; align-items: baseline; justify-content: space-between; }
	h2 { margin: 0 0 6px; font-size: 18px; font-weight: 600; }
	h3 { margin: 16px 0 8px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
	.subhead { display: flex; align-items: baseline; justify-content: space-between; }
	.reset, .manage { font-size: 13px; font-weight: 600; color: var(--signal-solid); }
	.chips { display: flex; flex-wrap: wrap; gap: 6px; }
	.chips button {
		min-height: 34px; padding: 0 13px; border-radius: 999px;
		background: var(--surface-raised); font-size: 13.5px; font-weight: 600; color: var(--text-dim);
	}
	.chips button.on { background: var(--signal); color: #fff; }
	.n { opacity: 0.7; font-weight: 500; }
	.none { font-size: 13px; color: var(--text-dim); align-self: center; }
	.done {
		width: 100%; min-height: 46px; margin-top: 20px; border-radius: 12px;
		background: var(--surface-raised); font-size: 15px; font-weight: 600; color: var(--text);
	}
</style>
