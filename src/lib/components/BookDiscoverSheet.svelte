<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { ERAS } from '$lib/discoverFilter';
	import { emptyBookFilter, bookEraId, toggleGenre, bookFilterQuery, type BookFilter, type BookDiscoverSort } from '$lib/bookFilter';

	/**
	 * Build a Books filter: genre(s), a decade and a sort — the book parallel to
	 * DiscoverFilterSheet. Hardcover has no people/keyword/service facets, so this
	 * is the smaller set it can browse by. Shows a live result count.
	 */
	let { filter, genres, onapply, onclose }: { filter: BookFilter; genres: string[]; onapply: (f: BookFilter) => void; onclose: () => void } = $props();

	// Seed once from the incoming filter (the sheet remounts each open), then own it.
	let draft = $state<BookFilter>(emptyBookFilter());
	let seeded = false;
	$effect(() => {
		if (seeded) return;
		seeded = true;
		draft = { ...filter, genres: [...filter.genres] };
	});

	const SORTS: { id: BookDiscoverSort; label: string }[] = [
		{ id: 'popular', label: 'Most read' },
		{ id: 'new', label: 'Newest' },
		{ id: 'rating', label: 'Top rated' }
	];

	function setEra(id: string) {
		const e = ERAS.find((x) => x.id === id);
		if (!e) return;
		if (bookEraId(draft) === id) draft = { ...draft, yearGte: null, yearLte: null };
		else draft = { ...draft, yearGte: e.gte, yearLte: e.lte };
	}

	/* Live count for the button. */
	let count = $state<number | null>(null);
	let countSeq = 0;
	$effect(() => {
		const query = bookFilterQuery(draft);
		const mine = ++countSeq;
		count = null;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/books/filter?${query}&page=1`);
				if (!res.ok) return;
				const b = await res.json();
				if (mine === countSeq) count = b.total ?? 0;
			} catch {
				/* leave the count blank */
			}
		}, 350);
		return () => clearTimeout(timer);
	});

	const countLabel = $derived(count === null ? 'Show results' : `Show ${count.toLocaleString()} result${count === 1 ? '' : 's'}`);
</script>

<Sheet label="Filter books" {onclose} scrollable>
	<div class="pad">
		<h3>Genre</h3>
		<div class="wrap">
			{#each genres as g (g)}
				<button class="chip" class:on={draft.genres.includes(g)} onclick={() => (draft = { ...draft, genres: toggleGenre(draft.genres, g) })}>{g}</button>
			{/each}
		</div>

		<h3>Era</h3>
		<div class="wrap">
			{#each ERAS as e (e.id)}
				<button class="chip" class:on={bookEraId(draft) === e.id} onclick={() => setEra(e.id)}>{e.label}</button>
			{/each}
		</div>

		<h3>Sort</h3>
		<div class="seg">
			{#each SORTS as s (s.id)}
				<button class:on={draft.sort === s.id} onclick={() => (draft = { ...draft, sort: s.id })}>{s.label}</button>
			{/each}
		</div>

		<div class="foot">
			<button class="ghost" onclick={() => (draft = emptyBookFilter())}>Clear</button>
			<button class="primary" onclick={() => onapply(draft)}>{countLabel}</button>
		</div>
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter) 10px; }
	h3 { margin: 16px 2px 7px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-dim); }
	h3:first-child { margin-top: 2px; }
	.wrap { display: flex; flex-wrap: wrap; gap: 6px; }
	.chip {
		min-height: 34px; padding: 0 12px; border-radius: 9px;
		background: var(--surface); font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.chip.on { background: var(--signal); color: #fff; }
	.seg { display: flex; gap: 3px; padding: 3px; border-radius: 10px; background: var(--surface); }
	.seg button { flex: 1; min-height: 34px; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
	.seg button.on { background: var(--surface-raised); color: var(--text); }
	.foot { display: flex; gap: 8px; margin-top: 18px; }
	.foot button { flex: 1; min-height: 46px; border-radius: 12px; font-size: 14px; font-weight: 600; }
	.foot .ghost { flex: 0 0 90px; background: var(--surface); color: var(--text); }
	.foot .primary { background: var(--signal); color: #fff; }
</style>
