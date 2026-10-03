<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import TabBar from '$lib/components/TabBar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import BookRow from '$lib/components/BookRow.svelte';
	import BookSheet from '$lib/components/BookSheet.svelte';
	import NotLinked from '$lib/components/NotLinked.svelte';
	import { notLinkedOf } from '$lib/notLinked';
	import { tabReselect } from '$lib/tabReselect';
	import {
		readingSections,
		requestLabel,
		type BookRequest,
		type ReadingBook,
		type WishBook
	} from '$lib/books';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let open = $state<ReadingBook | null>(null);
	let openWish = $state<WishBook | null>(null);

	/* ── Your yearly goal: tap to change it (or set one) ─────────────────── */
	type Goal = { goalBooks: number; completedBooks: number; year: number };
	let goalSaved = $state<Goal | null>(null);
	let editingGoal = $state(false);
	let goalInput = $state('');
	let goalError = $state<string | null>(null);
	let goalBusy = $state(false);

	function editGoal(current: Goal | null) {
		goalInput = current?.goalBooks ? String(current.goalBooks) : '';
		goalError = null;
		editingGoal = true;
	}
	async function saveGoal() {
		const books = Number(goalInput);
		if (!Number.isInteger(books) || books < 1 || books > 1000) {
			goalError = 'Pick a number of books between 1 and 1000.';
			return;
		}
		goalBusy = true;
		goalError = null;
		try {
			const res = await fetch('/api/books/goal', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ books })
			});
			if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `HTTP ${res.status}`);
			goalSaved = (await res.json()).goal;
			editingGoal = false;
		} catch (e) {
			goalError = `Couldn't save — ${(e as Error).message}`;
		} finally {
			goalBusy = false;
		}
	}

	/* Your requests arrive on their own (they're a nicety — BookOrbit may be slow). */
	let requests = $state<BookRequest[]>([]);
	$effect(() => {
		let live = true;
		data.requests.then((r) => live && (requests = r));
		return () => {
			live = false;
		};
	});

	/* A wishlisted book drawn as a reading-list row. It has no BookOrbit id, so
	   its key is the (negated) Hardcover id — never collides with a library id. */
	const asRow = (w: WishBook): ReadingBook => ({
		id: -w.hardcoverId,
		title: w.title,
		authors: w.author ? [w.author] : [],
		status: 'want_to_read',
		progress: null,
		rating: null,
		pageCount: null,
		year: w.year,
		seriesName: null,
		seriesIndex: null,
		coverUrl: w.coverUrl,
		hardcoverId: w.hardcoverId
	});

	/* A request as a wish-shaped card, so it opens the same sheet. */
	const asWish = (r: BookRequest): WishBook => ({
		hardcoverId: r.hardcoverId ?? 0,
		title: r.title,
		author: r.author,
		coverUrl: r.coverUrl,
		year: null,
		rating: null,
		addedAt: r.createdAt
	});
	const requestNote = (r: BookRequest) =>
		`${requestLabel(r.status)}${r.progress !== null ? ` · ${Math.round(r.progress * 100)}%` : ''}`;

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
		{#await data.goal then loaded}
			{@const goal = goalSaved ?? loaded}
			{#if editingGoal}
				<form class="goal" onsubmit={(e) => { e.preventDefault(); void saveGoal(); }}>
					<label class="goaltext" for="goal-books">
						<span class="label">Books to read in {goal?.year ?? new Date().getFullYear()}</span>
					</label>
					<div class="goaledit">
						<!-- svelte-ignore a11y_autofocus -->
						<input id="goal-books" type="number" inputmode="numeric" min="1" max="1000" bind:value={goalInput} autofocus />
						<button type="submit" class="save" disabled={goalBusy}>Save</button>
						<button type="button" class="cancel" onclick={() => (editingGoal = false)}>Cancel</button>
					</div>
					{#if goalError}<p class="goalerr">{goalError}</p>{/if}
				</form>
			{:else if goal && goal.goalBooks > 0}
				{@const done = Math.min(goal.completedBooks, goal.goalBooks)}
				<button class="goal" onclick={() => editGoal(goal)} aria-label="Change your reading goal">
					<span class="goaltext">
						<span class="label">{goal.year} reading goal</span>
						<span class="hint tnum">{goal.completedBooks} of {goal.goalBooks} books</span>
					</span>
					<span class="track"><span class="fill" style:width={`${(done / goal.goalBooks) * 100}%`}></span></span>
				</button>
			{:else}
				<button class="setgoal" onclick={() => editGoal(goal)}>+ Set a reading goal for {goal?.year ?? new Date().getFullYear()}</button>
			{/if}
		{/await}

		{#await data.library}
			<ul class="rows">
				{#each Array(5) as _, i (i)}<li><Skeleton height="98px" radius={14} /></li>{/each}
			</ul>
		{:then books}
			{@const groups = readingSections(books, data.wishlist, requests)}
			{@const library = unstarted(books)}
			{#each groups as g (g.title)}
				{@const all = expanded[g.title]}
				{@const rows = [
					...g.books.map((b) => ({ b, wish: null, note: null })),
					...g.requests.map((r) => ({
						// Never collides with a library id (positive) or a wish (−hardcoverId).
						b: { ...asRow(asWish(r)), id: -1e9 - r.id },
						wish: r.hardcoverId ? asWish(r) : null,
						note: requestNote(r)
					})),
					...g.wishes.map((w) => ({ b: asRow(w), wish: w, note: 'Not in your library yet' }))
				]}
				<section class="group">
					<h2>{g.title} <span class="count tnum">{rows.length}</span></h2>
					<ul class="rows">
						{#each all ? rows : rows.slice(0, CAP) as r (r.b.id)}
							<li>
								{#if r.note}
									{@const w = r.wish}
									<BookRow book={r.b} note={r.note} onopen={() => w && (openWish = w)} />
								{:else}
									<BookRow book={r.b} onopen={(x) => (open = x)} />
								{/if}
							</li>
						{/each}
					</ul>
					{#if rows.length > CAP}
						<button class="more" onclick={() => (expanded = { ...expanded, [g.title]: !all })}>
							{all ? 'Show fewer' : `Show all ${rows.length}`}
						</button>
					{/if}
				</section>
			{/each}

			{#if !groups.length}
				<div class="empty">
					<h2>Nothing on your reading list yet</h2>
					<p>
						Mark books as reading or want-to-read in BookOrbit (or on your reader) and they'll show up
						here. Find something new in Discover → Books and tap Want to read.
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
	<BookSheet
		hardcoverId={open.hardcoverId}
		library={open}
		onclose={() => (open = null)}
		onchange={() => invalidateAll()}
	/>
{/if}

{#if openWish}
	<BookSheet
		hardcoverId={openWish.hardcoverId}
		card={{ ...openWish, owned: null, wished: true }}
		onclose={() => (openWish = null)}
		onchange={() => invalidateAll()}
	/>
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
	button.goal { width: 100%; text-align: left; }
	.goaledit { display: flex; gap: 8px; }
	.goaledit input {
		flex: 1; min-width: 0; height: 40px; padding: 0 12px; border: none; border-radius: 10px;
		background: var(--surface-raised); color: var(--text); font: inherit; font-size: 16px; outline: none;
	}
	.goaledit button { flex: none; height: 40px; padding: 0 14px; border-radius: 10px; font-size: 14px; font-weight: 650; }
	.goaledit .save { background: var(--signal); color: #fff; }
	.goaledit .save:disabled { opacity: 0.6; }
	.goaledit .cancel { background: var(--surface-raised); color: var(--text-dim); }
	.goalerr { margin: 0; font-size: 12.5px; color: #ff8a8a; }
	.setgoal {
		display: block; width: 100%; margin: 6px 0 18px; padding: 12px 14px; border-radius: 14px;
		background: var(--surface); text-align: left; font-size: 14px; font-weight: 600; color: var(--signal-solid);
	}

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
