<script lang="ts">
	import GoalSheet from '$lib/components/GoalSheet.svelte';
	import { setSegment } from '$lib/segment';
	import { goto, invalidateAll } from '$app/navigation';
	import TabBar from '$lib/components/TabBar.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import BookRow from '$lib/components/BookRow.svelte';
	import BookSheet from '$lib/components/BookSheet.svelte';
	import SortSheet from '$lib/components/SortSheet.svelte';
	import BookFilterSheet from '$lib/components/BookFilterSheet.svelte';
	import ShelvesSheet from '$lib/components/ShelvesSheet.svelte';
	import { tabReselect } from '$lib/tabReselect';
	import {
		BOOK_SORTS,
		NO_BOOK_FILTERS,
		bookFiltersActive,
		filterBooks,
		myBooks,
		readingSections,
		requestLabel,
		sortBooks,
		topGenres,
		type DiscoveryCard,
		type BookFilters,
		type BookRequest,
		type BookSort,
		type MyBook,
		type ReadingGoalItem
	} from '$lib/books';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	// Remember the segment, so the other tab opens on it too.
	$effect(() => setSegment('book'));

	/* The sheet: a book from your list, or a Hardcover card (from the + search or
	   a request on its way). */
	type Card = DiscoveryCard;
	let openBook = $state<MyBook | null>(null);
	let openCard = $state<Card | null>(null);
	const closeSheet = () => {
		openBook = null;
		openCard = null;
	};

	/* ── Your goal: the books goal running today, edited in the goal sheet ── */
	let goalsSaved = $state<ReadingGoalItem[] | null>(null);
	let editingGoal = $state<ReadingGoalItem | null | 'new'>(null);
	const today = new Date().toLocaleDateString('en-CA');
	const yearGoal = (goals: ReadingGoalItem[]) =>
		goals.find((g) => g.metric === 'book' && g.startDate <= today && today <= g.endDate) ?? null;
	async function goalsChanged(saved: ReadingGoalItem[]) {
		goalsSaved = saved.length
			? saved
			: await fetch('/api/books/goals').then((r) => (r.ok ? r.json() : { goals: [] })).then((d) => d.goals);
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
	const requestNote = (r: BookRequest) =>
		`${requestLabel(r.status)}${r.progress !== null ? ` · ${Math.round(r.progress * 100)}%` : ''}`;
	/* A request as a row: it isn't a book of yours yet, so it's drawn from what
	   the request knows, and opens as a Hardcover card. */
	const requestRow = (r: BookRequest): MyBook => ({
		key: `req:${r.id}`,
		source: 'entry',
		libraryId: null,
		hardcoverId: r.hardcoverId,
		title: r.title,
		authors: r.author ? [r.author] : [],
		coverUrl: r.coverUrl,
		year: null,
		status: 'want_to_read',
		myRating: null,
		pages: null,
		progress: null,
		seriesName: null,
		seriesIndex: null,
		genres: [],
		formats: [],
		addedAt: r.createdAt,
		activeAt: r.createdAt,
		startedAt: null,
		finishedAt: null
	});

	/* ── Sort and filter (kept on this device) ─────────────────────────────── */
	const VIEW_KEY = 'seek:books:view';
	let sort = $state<BookSort>('active');
	let filters = $state<BookFilters>({ ...NO_BOOK_FILTERS });
	try {
		const saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
		if (saved?.sort) sort = saved.sort;
		if (saved?.filters) filters = { ...NO_BOOK_FILTERS, ...saved.filters };
	} catch {
		/* private mode, or nothing saved */
	}
	function remember() {
		try {
			localStorage.setItem(VIEW_KEY, JSON.stringify({ sort, filters }));
		} catch {
			/* not essential */
		}
	}
	let sortOpen = $state(false);
	let filterOpen = $state(false);
	let shelvesOpen = $state(false);

	/* A shelf filter needs that shelf's books (BookOrbit knows; we ask). */
	let shelfIds = $state<Set<number> | null>(null);
	$effect(() => {
		const id = filters.shelf;
		shelfIds = null;
		if (id === null) return;
		let live = true;
		fetch(`/api/books/shelves/${id}`)
			.then((r) => (r.ok ? r.json() : { books: [] }))
			.then((b) => live && (shelfIds = new Set((b.books ?? []).map((x: { id: number }) => x.id))))
			.catch(() => live && (shelfIds = new Set()));
		return () => {
			live = false;
		};
	});

	/* Long sections would bury everything after them; they open on request. */
	const CAP = 8;
	let expanded = $state<Record<string, boolean>>({});
	/* Owned but never started — the library, not the reading list. Collapsed,
	   unless you filtered to it. */
	let showLibrary = $state(false);
	let libraryShown = $state(40);
</script>

<div class="app">
	<header>
		<div class="segments" role="tablist">
			{#if data.media.tv}<button role="tab" aria-selected="false" onclick={() => goto('/?type=tv', { noScroll: true })}>TV Shows</button>{/if}
			{#if data.media.movie}<button role="tab" aria-selected="false" onclick={() => goto('/?type=movie', { noScroll: true })}>Movies</button>{/if}
			<button role="tab" aria-selected="true" class="active">Books</button>
		</div>
		<button class="hbtn" onclick={() => (sortOpen = true)} aria-label="Sort">
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M6.5 12h11M10 17h4" /></svg>
		</button>
		<button class="hbtn last" class:on={bookFiltersActive(filters)} onclick={() => (filterOpen = true)} aria-label="Filter">
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>
		</button>
	</header>

	<main use:tabReselect={{ tab: 'watchlist' }}>
		{#if data.hardcoverLinked}
		{#await data.goals then loaded}
			{@const goal = yearGoal(goalsSaved ?? loaded)}
			{#if goal}
				{@const done = Math.min(goal.done, goal.target)}
				<button class="goal" onclick={() => (editingGoal = goal)} aria-label="Change your reading goal">
					<span class="goaltext">
						<span class="label">{goal.title}</span>
						<span class="hint tnum">{Math.round(goal.done)} of {goal.target} books</span>
					</span>
					<span class="track"><span class="fill" style:width={`${(done / goal.target) * 100}%`}></span></span>
				</button>
			{:else}
				<button class="setgoal" onclick={() => (editingGoal = 'new')}>+ Set a reading goal for {new Date().getFullYear()}</button>
			{/if}
		{:catch}
			<!-- Hardcover unreachable: the list below says so. -->
		{/await}
		{/if}

		{#if !data.hardcoverLinked}
			<p class="linkhint">
				Link your Hardcover account in <a href="/profile/settings?s=accounts">Settings → Your accounts</a> — it's
				where what you read, want to read and rate is kept.
			</p>
		{:else if !data.linked && data.canLink}
			<p class="linkhint">
				Link your BookOrbit login in <a href="/profile/settings?s=accounts">Settings → Your accounts</a> to see the library here too.
			</p>
		{/if}

		{#await Promise.all([data.library, data.shelf])}
			<ul class="rows">
				{#each Array(5) as _, i (i)}<li><Skeleton height="98px" radius={14} /></li>{/each}
			</ul>
		{:then [library, shelf]}
			{@const all = myBooks(library, shelf)}
			{@const shown = sortBooks(filterBooks(all, filters, shelfIds), sort)}
			{@const filtering = bookFiltersActive(filters)}
			{@const groups = readingSections(shown, filtering ? [] : requests)}
			{@const unstarted = shown.filter((b) => b.status === 'unread')}
			{@const genres = topGenres(all)}
			{#each groups as g (g.title)}
				{@const open = expanded[g.title]}
				{@const rows = [
					...g.requests.map((r) => ({ b: requestRow(r), note: requestNote(r), req: r })),
					...g.books.map((b) => ({ b, note: null, req: null }))
				]}
				<section class="group">
					<h2>{g.title} <span class="count tnum">{rows.length}</span></h2>
					<ul class="rows">
						{#each open ? rows : rows.slice(0, CAP) as r (r.b.key)}
							<li>
								<BookRow
									book={r.b}
									note={r.note}
									onopen={() => {
										if (r.req) {
											if (r.req.hardcoverId) openCard = { hardcoverId: r.req.hardcoverId, title: r.req.title, author: r.req.author, coverUrl: r.req.coverUrl, year: null, rating: null };
										} else openBook = r.b;
									}}
								/>
							</li>
						{/each}
					</ul>
					{#if rows.length > CAP}
						<button class="more" onclick={() => (expanded = { ...expanded, [g.title]: !open })}>
							{open ? 'Show fewer' : `Show all ${rows.length}`}
						</button>
					{/if}
				</section>
			{/each}

			{#if !groups.length && !unstarted.length}
				<div class="empty">
					{#if filtering}
						<h2>No books match</h2>
						<p><button class="linkbtn" onclick={() => { filters = { ...NO_BOOK_FILTERS }; remember(); }}>Clear the filters</button></p>
					{:else}
						<h2>Nothing on your reading list yet</h2>
						<p>Tap + to add a book — one you're reading, have read, or want to. Or find something new in Discover → Books.</p>
					{/if}
				</div>
			{/if}

			{#if unstarted.length}
				{@const libOpen = showLibrary || filters.status === 'unstarted'}
				<section class="group">
					<button class="libhead" onclick={() => (showLibrary = !showLibrary)}>
						<h2>Your library <span class="count tnum">{unstarted.length}</span></h2>
						<span class="chev">{libOpen ? '−' : '+'}</span>
					</button>
					{#if libOpen}
						<ul class="rows">
							{#each unstarted.slice(0, libraryShown) as b (b.key)}
								<li><BookRow book={b} onopen={(x) => (openBook = x)} /></li>
							{/each}
						</ul>
						{#if unstarted.length > libraryShown}
							<button class="more" onclick={() => (libraryShown += 60)}>Show more</button>
						{/if}
					{/if}
				</section>
			{/if}

			{#if filterOpen}
				<BookFilterSheet
					{filters}
					{genres}
					resultCount={shown.length}
					onchange={(f) => {
						filters = f;
						remember();
					}}
					onmanage={() => {
						filterOpen = false;
						shelvesOpen = true;
					}}
					onclose={() => (filterOpen = false)}
				/>
			{/if}

		{:catch err}
			<div class="empty"><h2>Can't reach Hardcover</h2><p>{err.message}</p></div>
		{/await}
	</main>

	{#if editingGoal}
		<GoalSheet goal={editingGoal === 'new' ? null : editingGoal} onclose={() => (editingGoal = null)} onsaved={goalsChanged} />
	{/if}

	<button class="fab" onclick={() => goto('/books/search')} aria-label="Add a book">
		<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14" stroke-linecap="round" /></svg>
	</button>

	<TabBar current="watchlist" />
</div>

{#if openBook || openCard}
	<BookSheet book={openBook} card={openCard} onclose={closeSheet} onchange={() => invalidateAll()} />
{/if}

{#if sortOpen}
	<SortSheet
		current={sort}
		options={BOOK_SORTS}
		onchange={(k) => {
			sort = k as BookSort;
			sortOpen = false;
			remember();
		}}
		onclose={() => (sortOpen = false)}
	/>
{/if}

{#if shelvesOpen}
	<ShelvesSheet onclose={() => (shelvesOpen = false)} />
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

	/* Header icons as on the TV/Movies watchlist. */
	.hbtn {
		flex: none; display: grid; place-items: center;
		width: 38px; height: var(--tap); border-radius: 11px; color: var(--text-dim);
	}
	.hbtn.last { margin-right: -8px; }
	.hbtn.on { color: var(--signal-solid); }

	/* Clear the tab bar and the floating + button. */
	main { padding: 4px var(--gutter) calc(var(--tabbar-footprint) + 88px); }

	.fab {
		position: fixed; right: var(--gutter);
		bottom: calc(var(--tabbar-h) + var(--tabbar-safe-b) + 16px);
		z-index: 40; display: grid; place-items: center;
		width: 56px; height: 56px; border-radius: 50%;
		background: var(--signal); color: #fff;
		box-shadow: 0 8px 24px color-mix(in srgb, var(--signal-solid) 34%, transparent);
	}
	.linkhint { margin: 0 0 16px; font-size: 13px; line-height: 1.45; color: var(--text-dim); }
	.linkhint a, .linkbtn { color: var(--signal-solid); font-weight: 600; }

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
