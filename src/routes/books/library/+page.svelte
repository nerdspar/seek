<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import BookSheet from '$lib/components/BookSheet.svelte';
	import ShelvesSheet from '$lib/components/ShelvesSheet.svelte';
	import { coverThumb, sortBooks, statusLabel, topGenres, type BookSort, type MyBook } from '$lib/books';
	import type { PageData } from './$types';

	/** The whole library as a cover grid: sort it, narrow it to a genre or one
	 *  of your shelves, and manage your shelves. Tap a book for its sheet. */
	let { data }: { data: PageData } = $props();

	const SORTS: { key: BookSort; label: string }[] = [
		{ key: 'added', label: 'Recently added' },
		{ key: 'title', label: 'Title' },
		{ key: 'author', label: 'Author' }
	];
	let sort = $state<BookSort>('added');
	let genre = $state<string | null>(null);
	let shelf = $state<number | null>(Number(page.url.searchParams.get('shelf')) || null);
	let shelfIds = $state<Set<number> | null>(null);
	let openBook = $state<MyBook | null>(null);
	let shelvesOpen = $state(false);
	let shown = $state(60);

	/* A shelf's books come from BookOrbit (asked for when you pick one). */
	$effect(() => {
		const id = shelf;
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

	const view = (books: MyBook[]) =>
		sortBooks(
			books.filter(
				(b) =>
					(genre === null || b.genres.some((g) => g.toLowerCase() === genre!.toLowerCase())) &&
					(shelf === null || (shelfIds !== null && b.libraryId !== null && shelfIds.has(b.libraryId)))
			),
			sort
		);
</script>

<PageHeader title="Library" onback={() => history.back()} />

<main>
	{#if !data.linked}
		<p class="msg">Link your BookOrbit login in Settings → Your accounts to see the library.</p>
	{:else}
		{#await Promise.all([data.books, data.shelves])}
			<div class="grid">{#each Array(9) as _, i (i)}<Skeleton height="156px" radius={9} />{/each}</div>
		{:then [books, shelves]}
			{@const genres = topGenres(books, 10)}
			{@const list = view(books)}
			<div class="bar">
				<span class="count tnum">{list.length} {list.length === 1 ? 'book' : 'books'}</span>
				<button class="link" onclick={() => (shelvesOpen = true)}>Shelves</button>
			</div>
			<div class="chips" role="tablist" aria-label="Sort">
				{#each SORTS as s (s.key)}
					<button class:on={sort === s.key} onclick={() => (sort = s.key)}>{s.label}</button>
				{/each}
			</div>
			{#if shelves.length}
				<div class="chips" aria-label="Shelf">
					<button class:on={shelf === null} onclick={() => (shelf = null)}>All shelves</button>
					{#each shelves as sh (sh.id)}
						<button class:on={shelf === sh.id} onclick={() => (shelf = sh.id)}>{sh.name}</button>
					{/each}
				</div>
			{/if}
			{#if genres.length}
				<div class="chips" aria-label="Genre">
					<button class:on={genre === null} onclick={() => (genre = null)}>All genres</button>
					{#each genres as g (g)}
						<button class:on={genre === g} onclick={() => (genre = g)}>{g}</button>
					{/each}
				</div>
			{/if}

			{#if shelf !== null && shelfIds === null}
				<p class="msg">Loading the shelf…</p>
			{:else if !list.length}
				<p class="msg">Nothing here{genre || shelf !== null ? ' with these choices' : ' yet'}.</p>
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

<style>
	main { padding: 4px var(--gutter) calc(var(--safe-b) + 32px); }
	.bar { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 8px; }
	.count { font-size: 13px; color: var(--text-dim); }
	.link { font-size: 14px; font-weight: 600; color: var(--signal-solid); }
	.chips { display: flex; gap: 6px; margin: 0 0 8px; overflow-x: auto; scrollbar-width: none; }
	.chips button {
		flex: none; min-height: 32px; padding: 0 12px; border-radius: 9px; background: var(--surface);
		font-size: 13px; font-weight: 600; color: var(--text-dim); white-space: nowrap;
	}
	.chips button.on { background: var(--surface-raised); color: var(--text); }
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
</style>
