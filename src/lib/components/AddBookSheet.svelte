<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Poster from './Poster.svelte';
	import SearchField from './SearchField.svelte';
	import { cardBadge, coverThumb, normTitle, statusLabel, type DiscoveryCard, type MyBook } from '$lib/books';

	/** The + on Watchlist → Books: find a book to add or change — one already in
	 *  your list or library, or any book at all (Hardcover). Picking one opens its
	 *  sheet, where you set the status, rating and so on. */
	type Card = DiscoveryCard;
	type Props = {
		/** Your list and library, searched right here. */
		books: MyBook[];
		onpick: (pick: { book: MyBook } | { card: Card }) => void;
		onclose: () => void;
	};
	let { books, onpick, onclose }: Props = $props();

	let query = $state('');
	let results = $state<Card[] | null>(null);
	let searching = $state(false);
	let error = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	/* Yours first: a quick local match on title or author. */
	const mineMatches = $derived.by(() => {
		const q = normTitle(query);
		if (q.length < 2) return [];
		return books
			.filter((b) => normTitle(b.title).includes(q) || b.authors.some((a) => a.toLowerCase().includes(query.trim().toLowerCase())))
			.slice(0, 6);
	});
	// Books already shown under "Yours" aren't repeated in the catalog results.
	const yoursIds = $derived(new Set(mineMatches.map((b) => b.hardcoverId).filter(Boolean)));

	function onInput() {
		clearTimeout(timer);
		const q = query.trim();
		if (!q) {
			results = null;
			error = null;
			return;
		}
		timer = setTimeout(() => void run(q), 300);
	}

	async function run(q: string) {
		const mine = ++seq;
		searching = true;
		error = null;
		try {
			const res = await fetch(`/api/books/search?q=${encodeURIComponent(q)}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = await res.json();
			if (mine === seq) results = body.results ?? [];
		} catch (e) {
			if (mine === seq) error = `Search failed — ${(e as Error).message}`;
		} finally {
			if (mine === seq) searching = false;
		}
	}
</script>

<Sheet label="Add a book" {onclose} scrollable>
	<div class="pad">
		<h2>Add or find a book</h2>
		<SearchField bind:value={query} placeholder="Title or author" oninput={onInput} onclear={onInput} onsubmit={() => { clearTimeout(timer); if (query.trim()) void run(query.trim()); }} />

		{#if !query.trim()}
			<p class="hint">Search your books and library, or any book — then set what you're doing with it.</p>
		{/if}

		{#if mineMatches.length}
			<h3>Yours</h3>
			<ul>
				{#each mineMatches as b (b.key)}
					<li>
						<button onclick={() => onpick({ book: b })}>
							<Poster src={coverThumb(b.coverUrl, 40)} width={40} height={60} radius={5} />
							<span class="text">
								<span class="title">{b.title}</span>
								<span class="sub">{[b.authors[0], statusLabel(b.status)].filter(Boolean).join(' · ')}</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if query.trim()}
			<h3>All books</h3>
			{#if error}
				<p class="hint bad">{error}</p>
			{:else if results === null || (searching && !results.length)}
				<p class="hint">Searching…</p>
			{:else if !results.filter((r) => !yoursIds.has(r.hardcoverId)).length}
				<p class="hint">No other books match.</p>
			{:else}
				<ul>
					{#each results.filter((r) => !yoursIds.has(r.hardcoverId)) as c (c.hardcoverId)}
						<li>
							<button onclick={() => onpick({ card: c })}>
								<Poster src={coverThumb(c.coverUrl, 40)} width={40} height={60} radius={5} />
								<span class="text">
									<span class="title">{c.title}</span>
									<span class="sub">{[c.author, c.year, cardBadge(c)].filter(Boolean).join(' · ')}</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter) 12px; }
	h2 { margin: 0 0 12px; font-size: 18px; font-weight: 600; }
	h3 { margin: 16px 0 8px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
	.hint { margin: 12px 2px 0; font-size: 13px; color: var(--text-dim); }
	.hint.bad { color: #ff8a8a; }
	ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
	li button {
		display: flex; align-items: center; gap: 12px; width: 100%;
		padding: 8px 10px; border-radius: 12px; background: var(--surface-raised); text-align: left;
	}
	.text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
	.title { font-size: 14.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.sub { font-size: 12px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
