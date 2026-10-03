<script lang="ts">
	import { goto } from '$app/navigation';
	import TabBar from '$lib/components/TabBar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import BookRow from '$lib/components/BookRow.svelte';
	import BookSheet from '$lib/components/BookSheet.svelte';
	import NotLinked from '$lib/components/NotLinked.svelte';
	import { notLinkedOf } from '$lib/notLinked';
	import { tabReselect } from '$lib/tabReselect';
	import { groupReading, type ReadingBook } from '$lib/books';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let open = $state<ReadingBook | null>(null);

	/* Long finished lists would bury everything after them; they open on request. */
	const CAP = 8;
	let expanded = $state<Record<string, boolean>>({});

	/* Owned but never started — the library, not the reading list. Collapsed. */
	let showLibrary = $state(false);
	let libraryShown = $state(40);
	const unstarted = (books: ReadingBook[]) =>
		books.filter((b) => b.status === 'unread').sort((a, b) => a.title.localeCompare(b.title));
</script>

<div class="app">
	<header>
		<div class="segments" role="tablist">
			<button role="tab" aria-selected="false" onclick={() => goto('/?type=tv', { noScroll: true })}>TV Shows</button>
			<button role="tab" aria-selected="false" onclick={() => goto('/?type=movie', { noScroll: true })}>Movies</button>
			<button role="tab" aria-selected="true" class="active">Books</button>
		</div>
	</header>

	<main use:tabReselect={{ tab: 'watchlist' }}>
		{#await data.goal then goal}
			{#if goal && goal.goalBooks > 0}
				{@const done = Math.min(goal.completedBooks, goal.goalBooks)}
				<section class="goal">
					<span class="goaltext">
						<span class="label">{goal.year} reading goal</span>
						<span class="hint tnum">{goal.completedBooks} of {goal.goalBooks} books</span>
					</span>
					<span class="track"><span class="fill" style:width={`${(done / goal.goalBooks) * 100}%`}></span></span>
				</section>
			{/if}
		{/await}

		{#await data.library}
			<ul class="rows">
				{#each Array(5) as _, i (i)}<li><Skeleton height="98px" radius={14} /></li>{/each}
			</ul>
		{:then books}
			{@const groups = groupReading(books)}
			{@const library = unstarted(books)}
			{#each groups as g (g.title)}
				{@const all = expanded[g.title]}
				<section class="group">
					<h2>{g.title} <span class="count tnum">{g.books.length}</span></h2>
					<ul class="rows">
						{#each all ? g.books : g.books.slice(0, CAP) as b (b.id)}
							<li><BookRow book={b} onopen={(x) => (open = x)} /></li>
						{/each}
					</ul>
					{#if g.books.length > CAP}
						<button class="more" onclick={() => (expanded = { ...expanded, [g.title]: !all })}>
							{all ? 'Show fewer' : `Show all ${g.books.length}`}
						</button>
					{/if}
				</section>
			{/each}

			{#if !groups.length}
				<div class="empty">
					<h2>Nothing on your reading list yet</h2>
					<p>
						Mark books as reading or want-to-read in BookOrbit (or on your reader) and they'll show up
						here. Find something new in Discover → Books.
					</p>
				</div>
			{/if}

			{#if library.length}
				<section class="group">
					<button class="libhead" onclick={() => (showLibrary = !showLibrary)}>
						<h2>Your library <span class="count tnum">{library.length}</span></h2>
						<span class="chev">{showLibrary ? '−' : '+'}</span>
					</button>
					{#if showLibrary}
						<ul class="rows">
							{#each library.slice(0, libraryShown) as b (b.id)}
								<li><BookRow book={b} onopen={(x) => (open = x)} /></li>
							{/each}
						</ul>
						{#if library.length > libraryShown}
							<button class="more" onclick={() => (libraryShown += 60)}>Show more</button>
						{/if}
					{/if}
				</section>
			{/if}
		{:catch err}
			{@const missing = notLinkedOf(err)}
			{#if missing}
				<NotLinked service={missing} />
			{:else}
				<div class="empty"><h2>Can't reach BookOrbit</h2><p>{err.message}</p></div>
			{/if}
		{/await}
	</main>

	<TabBar current="watchlist" />
</div>

{#if open}
	<BookSheet hardcoverId={open.hardcoverId} library={open} onclose={() => (open = null)} />
{/if}

<style>
	/* Frame from the global `.app` shell (app.css); the segments mirror the
	   watchlist's so Books reads as its third segment. */
	header { display: flex; align-items: center; }
	.segments {
		display: flex; flex: 1; gap: 2px; padding: 3px;
		border-radius: 11px; background: var(--surface);
	}
	.segments button {
		flex: 1; min-height: 38px; border-radius: 9px;
		font-size: 13px; font-weight: 600; color: var(--text-dim);
		transition: background 140ms ease, color 140ms ease;
	}
	.segments button.active { background: var(--surface-raised); color: var(--text); }

	main { padding: 4px var(--gutter) calc(var(--tabbar-footprint) + 24px); }

	.goal {
		display: flex; flex-direction: column; gap: 8px;
		margin: 6px 0 18px; padding: 12px 14px;
		border-radius: 14px; background: var(--surface);
	}
	.goaltext { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
	.label { font-size: 14px; font-weight: 650; }
	.hint { font-size: 12.5px; color: var(--text-dim); }
	.goal .track { height: 6px; border-radius: 3px; background: var(--surface-raised); overflow: hidden; }
	.goal .fill { display: block; height: 100%; border-radius: 3px; background: var(--signal); }

	.group { margin-bottom: 22px; }
	.group h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
	.count { margin-left: 4px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
	.rows { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
	.more { margin-top: 10px; font-size: 13px; font-weight: 600; color: var(--signal-solid); }
	.libhead { display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; }
	.libhead h2 { margin: 0 0 8px; }
	.chev { font-size: 20px; color: var(--text-dim); }

	.empty { margin: 14vh 0 24px; text-align: center; }
	.empty h2 { margin: 0 0 8px; font-size: 17px; }
	.empty p { margin: 0 auto; max-width: 320px; font-size: 14px; line-height: 1.45; color: var(--text-dim); }
</style>
