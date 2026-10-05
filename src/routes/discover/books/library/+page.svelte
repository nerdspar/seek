<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import UploadSheet from '$lib/components/UploadSheet.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import BookSheet from '$lib/components/BookSheet.svelte';
	import ShelvesSheet from '$lib/components/ShelvesSheet.svelte';
	import SortSheet from '$lib/components/SortSheet.svelte';
	import BookFilterSheet from '$lib/components/BookFilterSheet.svelte';
	import {
		NO_BOOK_FILTERS,
		bookFiltersActive,
		coverThumb,
		filterBooks,
		sortBooks,
		statusLabel,
		topGenres,
		type BookFilters,
		type BookSort,
		type MyBook
	} from '$lib/books';
	import type { PageData } from './$types';

	/** In my library: everything in BookOrbit as a cover grid — the books
	 *  side of Discover's "On the server". Sort and Filter (your status — "Not
	 *  started" included — kind, shelf, genre, managing shelves) sit in one
	 *  row. Tap a book for its sheet. */
	let { data }: { data: PageData } = $props();
	/* Upload your own files into the library (BookOrbit). */
	let uploading = $state(false);

	const SORTS: { key: BookSort; label: string }[] = [
		{ key: 'added', label: 'Recently added' },
		{ key: 'title', label: 'Title' },
		{ key: 'author', label: 'Author' },
		{ key: 'rating', label: 'Your rating' }
	];
	let sort = $state<BookSort>('added');
	let filters = $state<BookFilters>({ ...NO_BOOK_FILTERS, shelf: Number(page.url.searchParams.get('shelf')) || null });
	let shelfIds = $state<Set<number> | null>(null);
	let openBook = $state<MyBook | null>(null);
	let shelvesOpen = $state(false);
	let sortOpen = $state(false);
	let filterOpen = $state(false);
	let shown = $state(60);

	/* A shelf's books come from BookOrbit (asked for when you pick one). */
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

	const view = (books: MyBook[]) => sortBooks(filterBooks(books, filters, shelfIds), sort);
</script>

{#snippet uploadAction()}
	<button class="upload" onclick={() => (uploading = true)} aria-label="Upload books">
		<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4m0 0-4 4m4-4 4 4M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14" /></svg>
	</button>
{/snippet}
<PageHeader title="In my library" onback={() => history.back()} action={data.canUpload ? uploadAction : undefined} />

<main>
	{#if !data.linked}
		<p class="msg">Link your BookOrbit login in Settings → Your accounts to see the library.</p>
	{:else}
		{#await Promise.all([data.books, data.shelves])}
			<div class="grid">{#each Array(9) as _, i (i)}<Skeleton height="156px" radius={9} />{/each}</div>
		{:then [books, shelves]}
			{@const genres = topGenres(books, 10)}
			{@const list = view(books)}
			<div class="controls">
				<span class="count tnum">{list.length} {list.length === 1 ? 'book' : 'books'}</span>
				<button class="ctl" onclick={() => (sortOpen = true)}>
					<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M6.5 12h11M10 17h4" /></svg>
					{SORTS.find((x) => x.key === sort)?.label}
				</button>
				<button class="ctl" class:on={bookFiltersActive(filters)} onclick={() => (filterOpen = true)}>
					<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>
					Filter
				</button>
			</div>
			{#if sortOpen}
				<SortSheet current={sort} options={SORTS} onchange={(k) => { sort = k as BookSort; sortOpen = false; }} onclose={() => (sortOpen = false)} />
			{/if}
			{#if filterOpen}
				<BookFilterSheet
					scope="library"
					{filters}
					{genres}
					resultCount={list.length}
					onchange={(f) => (filters = f)}
					onmanage={() => { filterOpen = false; shelvesOpen = true; }}
					onclose={() => (filterOpen = false)}
				/>
			{/if}

			{#if filters.shelf !== null && shelfIds === null}
				<p class="msg">Loading the shelf…</p>
			{:else if !list.length}
				<p class="msg">Nothing here{bookFiltersActive(filters) ? ' with these filters' : ' yet'}.</p>
			{:else}
				<ul class="grid">
					{#each list.slice(0, shown) as b (b.key)}
						<li>
							<button onclick={() => (openBook = b)}>
								<Poster src={coverThumb(b.coverUrl, 104)} width={104} height={156} radius={9} />
								{#if b.status !== 'unread'}<span class="badge">{statusLabel(b.status)}</span>{/if}
								<span class="cap">{b.title}</span>
								<span class="sub">{b.authors[0] ?? ''}</span>
							</button>
						</li>
					{/each}
				</ul>
				{#if list.length > shown}
					<button class="more" onclick={() => (shown += 90)}>Show more</button>
				{/if}
			{/if}
		{:catch err}
			<p class="msg">Couldn't load the library — {err.message}</p>
		{/await}
	{/if}
</main>

{#if openBook}
	<BookSheet book={openBook} onclose={() => (openBook = null)} onchange={() => invalidateAll()} />
{/if}
{#if shelvesOpen}
	<ShelvesSheet onclose={() => { shelvesOpen = false; void invalidateAll(); }} />
{/if}

{#if uploading}
	<UploadSheet onclose={() => (uploading = false)} ondone={() => invalidateAll()} />
{/if}

<style>
	main { padding: 4px var(--gutter) calc(var(--safe-b) + 32px); }
	.controls { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
	.count { flex: 1; font-size: 13px; color: var(--text-dim); }
	.ctl {
		display: flex; align-items: center; gap: 7px; min-height: 34px; padding: 0 12px; border-radius: 9px;
		background: var(--surface-raised); font-size: 13px; font-weight: 600; color: var(--text);
	}
	.ctl.on { background: var(--signal); color: #fff; }
	.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 16px 12px; margin: 12px 0 0; padding: 0; list-style: none; }
	.grid li > button { position: relative; width: 100%; text-align: left; }
	.badge {
		position: absolute; left: 5px; top: 133px; max-width: calc(100% - 10px); padding: 2px 6px; border-radius: 6px;
		font-size: 10px; font-weight: 700; background: color-mix(in srgb, var(--bg) 82%, transparent);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.cap {
		display: -webkit-box; margin-top: 6px; font-size: 12.5px; font-weight: 600; line-height: 1.3;
		overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
	}
	.sub { display: block; font-size: 11px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.msg { margin: 40px 0; text-align: center; font-size: 14px; color: var(--text-dim); }
	.more { display: block; margin: 16px auto 0; font-size: 14px; font-weight: 600; color: var(--signal-solid); }
	.upload { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--text); }
</style>
