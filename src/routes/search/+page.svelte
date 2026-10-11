<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import AddButton from '$lib/components/AddButton.svelte';
	import ArrButton from '$lib/components/ArrButton.svelte';
	import ArrAddSheet from '$lib/components/ArrAddSheet.svelte';
	import { loadArrStatus } from '$lib/arr.svelte';
	import { trackedOf, setTitle, confirmTitle, revertTitle } from '$lib/status.svelte';
	import { confirmShowAdded } from '$lib/together';
	import { searchLibrary, type LibraryTitle } from '$lib/librarySearch';
	import { statusLabel } from '$lib/tracking';
	import type { DiscoveryCard } from '$lib/books';
	import DiscoverFilterSheet from '$lib/components/DiscoverFilterSheet.svelte';
	import { emptyFilter, filterQuery, isActive, type DiscoverFilter } from '$lib/discoverFilter';
	import { searchSections } from '$lib/searchView';
	import type { SearchResult, TmdbResult } from '$lib/types';
	import type { PageData } from './$types';

	let arrRequest = $state<{ mediaType: string; tmdbId: string; title: string } | null>(null);
	let library = $state<LibraryTitle[]>([]);
	onMount(() => {
		void loadArrStatus();
		// Your whole list, once, so matches show instantly as you type.
		fetch('/api/library/titles')
			.then((r) => (r.ok ? r.json() : { titles: [] }))
			.then((b: { titles: LibraryTitle[] }) => (library = b.titles))
			.catch(() => {});
	});

	// Tapping an actor on a show/film lands here filtered to them (by id, or by
	// name while cast ids are still backfilling).
	onMount(() => {
		const sp = page.url.searchParams;
		const type = sp.get('type') === 'movie' ? 'movie' : 'tv';
		const pid = Number(sp.get('people'));
		const pname = sp.get('pname');
		const personName = sp.get('person');
		if (pid && pname) {
			applyFilter({ ...emptyFilter(type), people: [{ id: pid, name: pname }] });
		} else if (personName) {
			fetch(`/api/discover/suggest?q=${encodeURIComponent(personName)}`)
				.then((r) => (r.ok ? r.json() : { people: [] }))
				.then((b) => {
					const top = (b.people ?? [])[0];
					if (top) applyFilter({ ...emptyFilter(type), people: [{ id: top.id, name: top.name }] });
				})
				.catch(() => {});
		}
	});

	let { data }: { data: PageData } = $props();

	/* All / Shows / Films, with Books when it's on. */
	type Scope = 'best' | 'tv' | 'movie' | 'books';
	const CHIPS: { id: Scope; label: string }[] = [
		{ id: 'best', label: 'All' },
		{ id: 'tv', label: 'Shows' },
		{ id: 'movie', label: 'Films' }
	];

	let query = $state(page.url.searchParams.get('q') ?? '');
	let scope = $state<Scope>('best');
	let results = $state<SearchResult[]>([]);
	let searching = $state(false);
	let failed = $state<string | null>(null);
	let busy = $state<Set<string>>(new Set());
	let input: HTMLInputElement | undefined = $state();

	const key = (r: SearchResult) => `${r.mediaType}:${r.source}:${r.mediaId}`;

	/* Browse by facets (genre, tags, people, service, era) — the filter sheet
	   builds it, the grid shows it. A set filter and a typed query are separate
	   modes: typing searches, an empty box with a filter browses. */
	let filter = $state<DiscoverFilter | null>(null);
	let filterSheet = $state(false);
	let filterResults = $state<(TmdbResult & { tracked?: boolean })[]>([]);
	let filterTotal = $state(0);
	let filterBusy = $state(false);
	const browsing = $derived(!query.trim() && filter !== null && isActive(filter));
	async function runFilter(f: DiscoverFilter) {
		filterBusy = true;
		try {
			const res = await fetch(`/api/discover/filter?${filterQuery(f)}&page=1`);
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			const b = await res.json();
			filterResults = b.results;
			filterTotal = b.total;
			failed = null;
		} catch (err) {
			failed = err instanceof Error ? err.message : String(err);
		} finally {
			filterBusy = false;
		}
	}
	function applyFilter(f: DiscoverFilter) {
		filter = isActive(f) ? f : null;
		filterSheet = false;
		query = '';
		if (filter) void runFilter(filter);
	}
	const filterTokens = $derived(
		filter
			? [
					...filter.people.map((t) => ({ kind: 'person' as const, id: t.id, label: t.name })),
					...filter.keywords.map((t) => ({ kind: 'keyword' as const, id: t.id, label: t.name }))
				]
			: []
	);
	function removeToken(tk: { kind: 'person' | 'keyword'; id: number }) {
		if (!filter) return;
		const next =
			tk.kind === 'person'
				? { ...filter, people: filter.people.filter((p) => p.id !== tk.id) }
				: { ...filter, keywords: filter.keywords.filter((k) => k.id !== tk.id) };
		applyFilter(next);
	}

	/* Books come from Hardcover, shown in All and under the Books chip. */
	let books = $state<DiscoveryCard[]>([]);
	let bookSearching = $state(false);
	let addedBooks = $state<Record<number, boolean>>({});
	const bookAdded = (c: DiscoveryCard) => addedBooks[c.hardcoverId] || Boolean(c.owned || c.mine);
	async function addBook(c: DiscoveryCard) {
		if (bookAdded(c)) return;
		addedBooks = { ...addedBooks, [c.hardcoverId]: true };
		try {
			const res = await fetch('/api/books/mine', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ hardcoverId: c.hardcoverId, status: 'want_to_read' })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
		} catch (err) {
			const { [c.hardcoverId]: _drop, ...rest } = addedBooks;
			addedBooks = rest;
			failed = err instanceof Error ? err.message : String(err);
		}
	}

	$effect(() => {
		input?.focus();
	});

	/* Already on your list, matched locally — the common case, instant. Scoped to
	   match the chip, and capped so it never buries the "add something new" rows. */
	const onList = $derived.by(() => {
		const q = query.trim();
		if (!q) return [];
		return searchLibrary(library, q, 20)
			.filter((t) => scope === 'best' || t.mediaType === scope)
			.slice(0, 8);
	});
	const onListIds = $derived(new Set(onList.map((t) => `${t.mediaType}:${t.mediaId}`)));
	/* New to you: the TMDB hits you don't already track (those are shown above). */
	const fresh = $derived(results.filter((r) => !onListIds.has(`${r.mediaType}:${r.mediaId}`)));

	/* Which result sections render — a pure decision so a TMDB error can't hide
	   books that loaded fine (they're independent sources). */
	const sections = $derived(
		searchSections({
			scope,
			onListCount: onList.length,
			freshCount: fresh.length,
			booksCount: books.length,
			searching,
			bookSearching,
			failed: failed !== null
		})
	);

	/* §6.4: live search, firing 1s after typing stops. */
	let seq = 0;
	$effect(() => {
		const q = query.trim();
		const s = scope;

		if (!q || s === 'books') {
			results = [];
			searching = false;
			failed = null;
			return;
		}

		searching = true;
		const mine = ++seq;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&scope=${s}`);
				if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
				const body = await res.json();
				if (mine !== seq) return;
				results = body.results;
				failed = null;
			} catch (err) {
				if (mine === seq) {
					results = []; // don't leave stale titles under the new query
					failed = err instanceof Error ? err.message : String(err);
				}
			} finally {
				if (mine === seq) searching = false;
			}
		}, 1000);

		return () => clearTimeout(timer);
	});

	/* Books, when books are on and the chip allows them (All or Books). */
	let bookSeq = 0;
	$effect(() => {
		const q = query.trim();
		const s = scope;
		if (!data.books || !q || (s !== 'best' && s !== 'books')) {
			books = [];
			bookSearching = false;
			return;
		}
		bookSearching = true;
		const mine = ++bookSeq;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/books/search?q=${encodeURIComponent(q)}`);
				if (!res.ok) return;
				const body = await res.json();
				if (mine !== bookSeq) return;
				books = body.results ?? [];
			} catch {
				/* a book search miss shouldn't blank the TMDB results */
			} finally {
				if (mine === bookSeq) bookSearching = false;
			}
		}, 1000);
		return () => clearTimeout(timer);
	});

	async function toggleAdd(r: SearchResult) {
		const k = key(r);
		if (busy.has(k)) return;
		const was = trackedOf(r.source, r.mediaId, r.tracked);
		const next = !was;

		const bset = new Set(busy);
		bset.add(k);
		busy = bset;
		setTitle(r.source, r.mediaId, { tracked: next });

		try {
			const res = await fetch('/api/library', {
				method: next ? 'POST' : 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: r.mediaType, source: r.source, mediaId: r.mediaId, title: r.title })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			confirmTitle(r.source, r.mediaId, { tracked: next });
			if (next && r.mediaType === 'tv') confirmShowAdded({ source: r.source, mediaId: r.mediaId, title: r.title }, body);
		} catch (err) {
			revertTitle(r.source, r.mediaId, ['tracked']);
			failed = err instanceof Error ? err.message : String(err);
		} finally {
			const done = new Set(busy);
			done.delete(k);
			busy = done;
		}
	}

	const isAdded = (r: SearchResult) => trackedOf(r.source, r.mediaId, r.tracked);
	const detail = (mt: string, src: string, id: string) => `/${mt === 'movie' ? 'movie' : 'show'}/${src}/${id}`;
</script>

<PageHeader title="Search" onback={() => history.back()} />

<main>
	<div class="field">
		<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
			<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" stroke-linecap="round" />
		</svg>
		<input
			bind:this={input}
			bind:value={query}
			type="search"
			placeholder="Search your library and TMDB"
			autocapitalize="off"
			autocorrect="off"
			spellcheck="false"
			enterkeyhint="search"
		/>
		{#if query}
			<button class="clear" onclick={() => (query = '')} aria-label="Clear">×</button>
		{/if}
	</div>

	<div class="chips" role="tablist">
		{#each CHIPS as chip (chip.id)}
			<button role="tab" aria-selected={scope === chip.id} class:on={scope === chip.id} onclick={() => (scope = chip.id)}>
				{chip.label}
			</button>
		{/each}
		{#if data.books}
			<button role="tab" aria-selected={scope === 'books'} class:on={scope === 'books'} onclick={() => (scope = 'books')}>Books</button>
		{/if}
		{#if scope !== 'books'}
			<button class="filterbtn" class:on={browsing} aria-label="Filter" onclick={() => { filter ??= emptyFilter(scope === 'movie' ? 'movie' : 'tv'); filterSheet = true; }}>
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>
			</button>
		{/if}
	</div>

	{#if browsing && filter}
		<div class="tokenbar">
			<button class="editf" onclick={() => (filterSheet = true)}>{filter.type === 'movie' ? 'Films' : 'Shows'} · {filter.sort === 'top' ? 'Top rated' : filter.sort === 'newest' ? 'Newest' : 'Recommended'}</button>
			{#each filterTokens as tk (tk.kind + tk.id)}
				<button class="ftok" onclick={() => removeToken(tk)}>{tk.label} ✕</button>
			{/each}
			<button class="clearf" onclick={() => (filter = null)}>Clear</button>
		</div>
	{/if}

	{#if failed}
		<p class="msg error">{failed}</p>
	{/if}

	{#if browsing}
		{#if filterBusy && !filterResults.length}
			<p class="msg">Finding…</p>
		{:else if filterResults.length}
			<ul class="grid">
				{#each filterResults as r (r.mediaType + r.mediaId)}
					<li>
						<button onclick={() => goto(detail(r.mediaType, r.source, r.mediaId))}>
							<Poster src={r.poster} width={104} height={156} radius={9} />
							<span class="cap">{r.title}</span>
							{#if r.year}<span class="sub tnum">{r.year}</span>{/if}
						</button>
						<span class="gridadd">
							<AddButton mediaType={r.mediaType} source={r.source} mediaId={r.mediaId} title={r.title} onerror={(m) => (failed = m)} />
						</span>
						<span class="gridarradd">
							<ArrButton mediaType={r.mediaType} tmdbId={r.mediaId} title={r.title} onadd={(i) => (arrRequest = i)} compact size={30} />
						</span>
					</li>
				{/each}
			</ul>
		{:else if !failed}
			<p class="msg">Nothing matches those filters. Loosen one.</p>
		{/if}
	{:else if !query.trim()}
		{#if data.trending.length}
			<h2 class="eyebrow">Trending now</h2>
			<ul class="grid">
				{#each data.trending as r (r.mediaId)}
					<li>
						<button onclick={() => goto(detail(r.mediaType, r.source, r.mediaId))}>
							<Poster src={r.poster} width={104} height={156} radius={9} />
							<span class="cap">{r.title}</span>
							{#if r.year}<span class="sub tnum">{r.year}</span>{/if}
						</button>
						<span class="gridadd">
							<AddButton mediaType={r.mediaType} source={r.source} mediaId={r.mediaId} title={r.title} onerror={(m) => (failed = m)} />
						</span>
						<span class="gridarradd">
							<ArrButton mediaType={r.mediaType} tmdbId={r.mediaId} title={r.title} onadd={(i) => (arrRequest = i)} compact size={30} />
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="msg">Search your library, or all of TMDB to add something new.</p>
		{/if}
	{:else}
		{#if scope !== 'books'}
			{#if sections.showOnList}
				<h2 class="eyebrow">On your list</h2>
				<ul class="results">
					{#each onList as t (t.mediaType + t.mediaId)}
						<li>
							<a class="body" href={detail(t.mediaType, 'tmdb', t.mediaId)}>
								<Poster src={t.poster} width={46} height={69} radius={7} />
								<span class="meta">
									<span class="title">{t.title}</span>
									<span class="sub tnum">{t.mediaType === 'movie' ? 'Film' : 'Show'}{t.year ? ` · ${t.year}` : ''}{statusLabel(t.status) ? ` · ${statusLabel(t.status)}` : ''}</span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}

			{#if sections.showFresh}
				<h2 class="eyebrow">{sections.showOnList ? 'Add something new' : 'From TMDB'}</h2>
				<ul class="results">
					{#each fresh as r (key(r))}
						<li>
							<a class="body" href={detail(r.mediaType, r.source, r.mediaId)}>
								<Poster src={r.poster} width={46} height={69} radius={7} />
								<span class="meta">
									<span class="title">{r.title}</span>
									<span class="sub tnum">{r.mediaType === 'tv' ? 'Show' : 'Film'}{r.year ? ` · ${r.year}` : ''}</span>
								</span>
							</a>
							<button
								class="add"
								class:on={isAdded(r)}
								disabled={busy.has(key(r))}
								aria-label={isAdded(r) ? `Remove ${r.title}` : `Add ${r.title}`}
								onclick={() => toggleAdd(r)}
							>
								{#if isAdded(r)}
									<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
								{:else}
									<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
								{/if}
							</button>
							<span class="rowarr">
								<ArrButton mediaType={r.mediaType} tmdbId={r.mediaId} title={r.title} onadd={(i) => (arrRequest = i)} compact size={34} />
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		{#if sections.showBooks}
			<h2 class="eyebrow">{scope === 'books' ? 'Books' : 'From your books shelf'}</h2>
			<ul class="results">
				{#each books as b (b.hardcoverId)}
					<li>
						<a class="body" href="/books">
							<Poster src={b.coverUrl} width={46} height={69} radius={7} />
							<span class="meta">
								<span class="title">{b.title}</span>
								<span class="sub">Book{b.author ? ` · ${b.author}` : ''}{b.year ? ` · ${b.year}` : ''}</span>
							</span>
						</a>
						<button
							class="add"
							class:on={bookAdded(b)}
							disabled={bookAdded(b)}
							aria-label={bookAdded(b) ? `${b.title} is on your shelf` : `Add ${b.title} to want to read`}
							onclick={() => addBook(b)}
						>
							{#if bookAdded(b)}
								<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
							{:else}
								<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if sections.showSearching}
			<p class="msg">Searching…</p>
		{:else if sections.showEmpty}
			<p class="msg">Nothing found for “{query.trim()}”.</p>
		{/if}
	{/if}
</main>

{#if arrRequest}
	<ArrAddSheet item={arrRequest} onclose={() => (arrRequest = null)} />
{/if}

{#if filterSheet && filter}
	<DiscoverFilterSheet {filter} onapply={applyFilter} onclose={() => (filterSheet = false)} />
{/if}

<style>
	main {
		padding: 4px var(--gutter) calc(var(--safe-b) + 32px);
	}

	.field {
		display: flex;
		align-items: center;
		gap: 9px;
		height: var(--tap);
		padding: 0 12px;
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text-dim);
	}
	.field input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 16px;
		outline: none;
		-webkit-appearance: none;
		appearance: none;
	}
	.field input::-webkit-search-cancel-button {
		display: none;
	}
	.clear {
		flex: none;
		width: 28px;
		height: 28px;
		font-size: 20px;
		color: var(--text-dim);
	}

	.chips {
		display: flex;
		gap: 6px;
		margin: 10px 0 14px;
		overflow-x: auto;
	}
	.chips button {
		flex: none;
		min-height: 34px;
		padding: 0 13px;
		border-radius: 9px;
		background: var(--surface);
		font-size: 13px;
		font-weight: 600;
		color: var(--text-dim);
	}
	.chips button.on {
		background: var(--surface-raised);
		color: var(--text);
	}
	.filterbtn {
		flex: none; margin-left: auto; display: grid; place-items: center;
		width: 34px; min-height: 34px; border-radius: 9px;
		background: var(--surface); color: var(--text-dim);
	}
	.filterbtn.on { background: var(--signal); color: #fff; }
	.tokenbar { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px; }
	.tokenbar button { min-height: 32px; padding: 0 11px; border-radius: 9px; font-size: 12.5px; font-weight: 600; }
	.editf { background: var(--surface-raised); color: var(--text); }
	.ftok { background: var(--signal); color: #fff; }
	.clearf { background: none; color: var(--text-dim); margin-left: auto; }

	.msg {
		margin: 40px 0;
		text-align: center;
		font-size: 14px;
		color: var(--text-dim);
	}
	.msg.error {
		color: #ff8a8a;
	}

	.eyebrow {
		margin: 16px 0 10px; font-size: 12.5px; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim);
	}
	.eyebrow:first-child { margin-top: 4px; }
	.grid {
		display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
		gap: 16px 12px; margin: 0; padding: 0; list-style: none;
	}
	.grid li { position: relative; }
	.grid li > button { width: 100%; text-align: left; }
	.gridadd { position: absolute; right: 5px; top: 128px; }
	.gridarradd { position: absolute; right: 5px; top: 5px; }
	.cap {
		display: -webkit-box; margin-top: 6px; font-size: 12.5px; font-weight: 600; line-height: 1.3;
		overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
	}
	.sub { display: block; font-size: 11px; color: var(--text-dim); }

	.results {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.results li {
		display: grid;
		grid-template-columns: 1fr auto auto;
		align-items: center;
		border-radius: var(--radius);
		background: var(--surface);
	}
	.rowarr {
		display: grid;
		place-items: center;
		padding-right: 8px;
	}
	.body {
		display: grid;
		grid-template-columns: 46px 1fr;
		align-items: center;
		gap: 12px;
		padding: 8px;
		min-width: 0;
		text-align: left;
		color: var(--text);
		text-decoration: none;
	}
	.meta {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.title {
		font-size: 15px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.add {
		display: grid;
		place-items: center;
		width: var(--tap);
		height: var(--tap);
		margin-right: 6px;
		border-radius: 50%;
		background: var(--surface-raised);
		color: var(--text);
	}
	.add.on {
		background: var(--signal);
		color: #fff;
	}
	.add:disabled {
		opacity: 0.5;
	}
</style>
