<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Poster from './Poster.svelte';
	import Skeleton from './Skeleton.svelte';
	import BookStatusSheet from './BookStatusSheet.svelte';
	import RatingSheet from './RatingSheet.svelte';
	import BookExtras from './BookExtras.svelte';
	import BookGet from './BookGet.svelte';
	import {
		coverThumb,
		progressText,
		statusLabel,
		type DiscoveryCard,
		type OwnedSummary,
		type BookDetail,
		type BookReadStatus,
		type BookRequest,
		type MyBook
	} from '$lib/books';

	/**
	 * A book's sheet. Opened from your list (`book`: a library book or one of your
	 * own) or from Discover (`card`: a Hardcover result). Whenever the book has a
	 * Hardcover id the sheet fills in the description, genres and series.
	 *
	 * The row under the cover works like a show's: a status chip that opens a
	 * picker, and a rating chip, plus the page you're on. All of it lives on your
	 * Hardcover shelf — for any book, in the library or not.
	 */
	type Props = {
		book?: MyBook | null;
		card?: DiscoveryCard | null;
		onclose: () => void;
		/** Called after your status / rating / pages changed, so the list can refresh. */
		onchange?: () => void;
	};
	let { book = null, card = null, onclose, onchange }: Props = $props();

	type Detail = BookDetail & {
		owned: OwnedSummary | null;
		/** Your shelf entry, for a book that isn't in the library. */
		shelf: { status: BookReadStatus; rating: number | null; progressPages: number | null } | null;
		canRequest?: boolean;
		request?: BookRequest | null;
	};
	let detail = $state<Detail | null>(null);
	let loading = $state(false);
	let failed = $state(false);

	/* The Hardcover id: given, or — for a library book BookOrbit hasn't matched
	   yet — looked up by exact title + author (null when it can't be sure). */
	const givenId = $derived(book?.hardcoverId ?? card?.hardcoverId ?? null);
	let matchedId = $state<number | null>(null);
	const hardcoverId = $derived(givenId ?? matchedId);

	$effect(() => {
		if (givenId || !book) return;
		let cancelled = false;
		loading = true;
		const params = new URLSearchParams({ title: book.title });
		if (book.authors[0]) params.set('author', book.authors[0]);
		fetch(`/api/books/match?${params}`)
			.then((r) => (r.ok ? r.json() : { hardcoverId: null }))
			.then((b) => {
				if (cancelled) return;
				matchedId = b.hardcoverId ?? null;
				// No match: nothing more to load.
				if (!matchedId) loading = false;
			})
			.catch(() => !cancelled && (loading = false));
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const id = hardcoverId;
		if (!id) return;
		let cancelled = false;
		loading = true;
		failed = false;
		fetch(`/api/books/detail/${id}`)
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((d) => !cancelled && (detail = d))
			.catch(() => !cancelled && (failed = true))
			.finally(() => !cancelled && (loading = false));
		return () => {
			cancelled = true;
		};
	});

	/* What we know immediately (from where it was tapped) vs. what the detail adds. */
	const title = $derived(detail?.title ?? book?.title ?? card?.title ?? '');
	const author = $derived(book?.authors[0] ?? detail?.author ?? card?.author ?? null);
	const authors = $derived(book?.authors.length ? book.authors.join(', ') : author);
	const cover = $derived(book?.coverUrl ?? detail?.coverUrl ?? card?.coverUrl ?? null);
	const year = $derived(book?.year ?? detail?.year ?? card?.year ?? null);
	const community = $derived(detail?.rating ?? card?.rating ?? null);
	const series = $derived(
		detail?.series ?? (book?.seriesName ? { name: book.seriesName, position: book.seriesIndex } : null)
	);

	/* ── Your state on it ──────────────────────────────────────────────────── */
	type Mine = {
		/** BookOrbit's id when it's in your library; null for one of your own books. */
		bookId: number | null;
		status: BookReadStatus | null;
		rating: number | null;
		pages: number | null;
		progress: number | null;
	};
	const base = $derived.by<Mine>(() => {
		if (book?.source === 'library')
			return { bookId: book.libraryId, status: book.status, rating: book.myRating, pages: book.pages, progress: book.progress };
		const owned = detail?.owned ?? card?.owned ?? null;
		if (owned)
			return { bookId: owned.bookId, status: owned.status, rating: owned.rating ?? null, pages: owned.pages ?? detail?.pages ?? null, progress: owned.progress };
		const e = detail?.shelf;
		if (e) {
			const pages = detail?.pages ?? null;
			const progress = e.status === 'read' ? 1 : pages && e.progressPages != null ? Math.min(1, e.progressPages / pages) : null;
			return { bookId: null, status: e.status, rating: e.rating, pages, progress };
		}
		if (book) return { bookId: null, status: book.status, rating: book.myRating, pages: book.pages ?? detail?.pages ?? null, progress: book.progress };
		return { bookId: null, status: null, rating: null, pages: detail?.pages ?? null, progress: null };
	});
	// Changes made here, shown at once (and kept if the detail reloads under them).
	let edits = $state<Partial<Mine>>({});
	const mine = $derived<Mine>({ ...base, ...edits });
	const owned = $derived(mine.bookId !== null);

	let busy = $state(false);
	let saveError = $state<string | null>(null);
	let statusOpen = $state(false);
	let ratingOpen = $state(false);

	/** The server's own words when it refuses. */
	const failure = async (res: Response) =>
		((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `HTTP ${res.status}`;

	/** Save to your Hardcover shelf: one change (status, rating or pages). */
	function save(change: { status?: BookReadStatus | null; rating?: number | null; pages?: number }) {
		return fetch('/api/books/mine', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ hardcoverId, ...change })
		});
	}

	async function run(optimistic: Partial<Mine>, write: () => Promise<Response>) {
		const before = edits;
		edits = { ...edits, ...optimistic };
		busy = true;
		saveError = null;
		try {
			const res = await write();
			if (!res.ok) throw new Error(await failure(res));
			onchange?.();
		} catch (e) {
			edits = before;
			saveError = `Couldn't save — ${(e as Error).message}`;
		} finally {
			busy = false;
		}
	}

	function pickStatus(next: BookReadStatus | 'remove') {
		statusOpen = false;
		if (!hardcoverId) return;
		// "Not started" (a library book) and "Remove" both take it off your shelf.
		if (next === 'remove' || next === 'unread') {
			void run({ status: owned ? 'unread' : null, rating: null, progress: null }, () => save({ status: null }));
			return;
		}
		if (next === mine.status) return;
		// Finishing a book fills its progress, like a reader would.
		void run({ status: next, ...(next === 'read' ? { progress: 1 } : {}) }, () => save({ status: next }));
	}

	function pickRating(n: number | null) {
		ratingOpen = false;
		if (!hardcoverId) return;
		// Rating a book you weren't tracking files it under Read.
		const status = mine.status && mine.status !== 'unread' ? mine.status : 'read';
		void run({ rating: n, status }, () => save({ rating: n }));
	}

	/* ── The page you're on (an e-reader reports it via BookOrbit's sync) ── */
	let pageEdit = $state<string | null>(null);
	function savePages() {
		const n = Number(pageEdit);
		if (!Number.isInteger(n) || n < 0) {
			saveError = 'Pages read is a whole number.';
			return;
		}
		pageEdit = null;
		const pages = mine.pages;
		void run({ progress: pages ? Math.min(1, n / pages) : mine.progress, status: 'reading' }, () => save({ pages: n }));
	}

	const reading = $derived(mine.status === 'reading' || mine.status === 'rereading' || mine.status === 'on_hold');
	const progressLine = $derived(progressText({ progress: mine.progress, pages: mine.pages }));
	const mainLabel = $derived(mine.status ? statusLabel(mine.status) : 'Add to my books');

	let expanded = $state(false);
</script>

<Sheet label={title || 'Book'} {onclose} scrollable>
	<div class="pad">
		<div class="hero">
			<Poster src={coverThumb(cover, 96)} width={96} height={144} radius={8} eager />
			<div class="facts">
				<h2>{title}</h2>
				{#if authors}<p class="by">{authors}</p>{/if}
				<p class="meta tnum">
					{[year, mine.pages ? `${mine.pages} pages` : null, community ? `★ ${community.toFixed(1)} on Hardcover` : null]
						.filter(Boolean)
						.join(' · ')}
				</p>
				{#if series}
					<p class="series">{series.name}{series.position ? ` · Book ${series.position}` : ''}</p>
				{/if}
				{#if owned}<p class="where">In your library</p>{/if}
			</div>
		</div>

		{#if hardcoverId}
			<!-- Same shape as a show's row: status opens a picker, the star rates. -->
			<div class="chips">
				<button class="chip main" class:on={mine.status !== null} disabled={busy} onclick={() => (statusOpen = true)}>
					<span>{mainLabel}</span>
				</button>
				<button
					class="chip side"
					class:on={mine.rating !== null}
					disabled={busy}
					aria-label={mine.rating !== null ? `Rated ${mine.rating} of 5 — change` : 'Rate this'}
					onclick={() => (ratingOpen = true)}
				>
					<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.85z" /></svg>
					{#if mine.rating !== null}<span class="tnum">{mine.rating}</span>{/if}
				</button>
			</div>
		{:else if owned && !loading}
			<p class="nohc">Hardcover doesn't have this book yet, so Seek can't track it. Add it on hardcover.app and it'll match.</p>
		{/if}

		{#if reading || (mine.progress !== null && mine.progress > 0 && mine.status !== 'read')}
			<div class="progress">
				{#if pageEdit !== null}
					<form class="pageform" onsubmit={(e) => { e.preventDefault(); savePages(); }}>
						<label for="pages-read">Page</label>
						<!-- svelte-ignore a11y_autofocus -->
						<input id="pages-read" type="number" inputmode="numeric" min="0" max={mine.pages ?? undefined} bind:value={pageEdit} autofocus />
						{#if mine.pages}<span class="of tnum">of {mine.pages}</span>{/if}
						<button type="submit" class="save" disabled={busy}>Save</button>
						<button type="button" class="cancel" onclick={() => (pageEdit = null)}>Cancel</button>
					</form>
				{:else}
					<span class="track"><span class="fill" style:width={`${Math.round((mine.progress ?? 0) * 100)}%`}></span></span>
					<span class="ptext tnum">{progressLine ?? 'Not started'}</span>
					{#if hardcoverId}
						<button
							class="update"
							onclick={() => (pageEdit = String(mine.pages && mine.progress != null ? Math.round(mine.progress * mine.pages) : ''))}
							>Update</button
						>
					{/if}
				{/if}
			</div>
		{/if}
		{#if saveError}<p class="err">{saveError}</p>{/if}

		{#if owned && mine.bookId}
			<BookExtras bookId={mine.bookId} />
		{:else if hardcoverId && detail}
			<BookGet
				{hardcoverId}
				book={{ title, author, coverUrl: detail.coverUrl ?? card?.coverUrl ?? null, year }}
				initial={detail.request ?? null}
				canRequest={detail.canRequest ?? false}
				{onchange}
			/>
		{/if}

		{#if hardcoverId || loading}
			{#if loading && !detail}
				<div class="sk"><Skeleton height="13px" /><Skeleton width="92%" height="13px" /><Skeleton width="70%" height="13px" /></div>
			{:else if detail}
				{#if detail.genres.length}
					<div class="tags">
						{#each detail.genres as g (g)}<span class="tag">{g}</span>{/each}
					</div>
				{/if}
				{#if detail.description}
					<p class="desc" class:clamped={!expanded}>{detail.description}</p>
					{#if detail.description.length > 280}
						<button class="more" onclick={() => (expanded = !expanded)}>{expanded ? 'Less' : 'More'}</button>
					{/if}
				{/if}
				{#if detail.readers}
					<p class="readers tnum">
						{detail.readers.toLocaleString()} readers on Hardcover{detail.ratingsCount
							? ` · ${detail.ratingsCount.toLocaleString()} ratings`
							: ''}
					</p>
				{/if}
			{:else if failed}
				<p class="note">Couldn't load more about this book from Hardcover.</p>
			{/if}
		{/if}
	</div>
</Sheet>

{#if statusOpen}
	<BookStatusSheet {title} status={mine.status} {owned} {busy} onpick={pickStatus} onclose={() => (statusOpen = false)} />
{/if}
{#if ratingOpen}
	<RatingSheet {title} score={mine.rating} max={5} {busy} onpick={pickRating} onclose={() => (ratingOpen = false)} />
{/if}

<style>
	.pad { padding: 4px var(--gutter) 8px; }
	.hero { display: flex; gap: 14px; align-items: flex-start; }
	.facts { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
	h2 { margin: 0; font-size: 19px; font-weight: 650; line-height: 1.25; letter-spacing: -0.01em; }
	.by { margin: 0; font-size: 14px; color: var(--text); }
	.meta, .series, .where { margin: 0; font-size: 12.5px; color: var(--text-dim); }
	.where { color: var(--signal-solid); font-weight: 600; }

	/* The show/movie row: fixed columns so the targets never move. */
	.chips {
		display: grid; grid-template-columns: var(--chip-main) var(--chip-side);
		gap: 6px; margin-top: 16px;
	}
	.chip {
		display: flex; align-items: center; justify-content: center; gap: 6px;
		min-height: var(--tap); border-radius: var(--radius);
		background: var(--surface-raised); color: var(--text-dim);
		font-size: 14px; font-weight: 600;
	}
	.chip.on { background: var(--signal); color: #fff; }
	.chip:disabled { opacity: 0.6; }
	.side { min-width: var(--chip-min); padding: 0 6px; }
	.main { padding: 0 12px; }
	.main span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	.progress {
		display: flex; align-items: center; gap: 10px;
		margin-top: 10px; padding: 10px 12px; min-height: 44px; box-sizing: border-box;
		border-radius: var(--radius); background: var(--surface-raised);
	}
	.track { flex: 1; height: 5px; border-radius: 3px; background: var(--surface); overflow: hidden; }
	.fill { display: block; height: 100%; border-radius: 3px; background: var(--signal); }
	.ptext { flex: none; font-size: 12.5px; color: var(--text-dim); }
	.update { flex: none; font-size: 13px; font-weight: 600; color: var(--signal-solid); }
	.pageform { display: flex; align-items: center; gap: 8px; width: 100%; }
	.pageform label { font-size: 13px; font-weight: 600; }
	.pageform input {
		width: 76px; height: 34px; padding: 0 10px; border: none; border-radius: 8px;
		background: var(--surface); color: var(--text); font: inherit; font-size: 16px; outline: none;
	}
	.of { font-size: 13px; color: var(--text-dim); }
	.pageform .save { margin-left: auto; font-size: 13px; font-weight: 650; color: var(--signal-solid); }
	.pageform .cancel { font-size: 13px; color: var(--text-dim); }
	.err { margin: 8px 0 0; font-size: 13px; color: #ff8a8a; }
	.note { margin: 14px 0 0; font-size: 13px; color: var(--text-dim); }

	.sk { display: flex; flex-direction: column; gap: 7px; margin-top: 16px; }
	.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; }
	.tag { padding: 4px 10px; border-radius: 999px; background: var(--surface-raised); font-size: 12px; font-weight: 600; color: var(--text-dim); }
	.desc { margin: 14px 0 0; font-size: 14.5px; line-height: 1.55; white-space: pre-line; }
	.desc.clamped {
		display: -webkit-box; -webkit-line-clamp: 6; line-clamp: 6;
		-webkit-box-orient: vertical; overflow: hidden;
	}
	.more { margin-top: 4px; font-size: 13px; font-weight: 600; color: var(--signal-solid); }
	.readers { margin: 14px 0 0; font-size: 12px; color: var(--text-dim); }
	.nohc { margin: 12px 0 0; font-size: 13px; line-height: 1.4; color: var(--text-dim); }
</style>
