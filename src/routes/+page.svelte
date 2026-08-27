<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { flip } from 'svelte/animate';
	import { prefersReducedMotion } from 'svelte/motion';
	import WatchRow from '$lib/components/WatchRow.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';
	import EpisodeSheet from '$lib/components/EpisodeSheet.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import SortSheet from '$lib/components/SortSheet.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import FilterSheet, { type Filters } from '$lib/components/FilterSheet.svelte';
	import { haptic } from '$lib/haptics';
	import type { MediaType, WatchlistRow } from '$lib/types';
	import type { SortKey } from '$lib/server/prefs';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let note = $state<string | null>(null);

	/* Optimistic edits live in an overlay keyed by row, and the list is derived
	   from the server payload plus that overlay. Holding the rows in $state and
	   filling them from an $effect would render an empty list during SSR —
	   effects do not run on the server — so every cold launch would flash
	   "Nothing here" before hydration. On a home-screen PWA that flash is the
	   first thing you see, and this screen is judged on how fast it appears. */
	let overrides = $state<Record<string, WatchlistRow>>({});

	/* Order is owned locally once a mark lands, so a row can move to where the
	   active sort says it now belongs (BACKLOG.md's top item). Null means "use
	   the server's order", which is the case on every fresh load. */
	let order = $state<string[] | null>(null);

	/** Rows from the resolved page, with local edits and ordering applied. */
	let serverRows = $state<WatchlistRow[]>([]);
	let total = $state(0);

	const rows = $derived.by(() => {
		const mapped = serverRows.map((r) => overrides[key(r)] ?? r);
		if (!order) return mapped;
		const byKey = new Map(mapped.map((r) => [key(r), r]));
		const sorted = order.map((k) => byKey.get(k)).filter((r): r is WatchlistRow => Boolean(r));
		// Anything the server sent that the local order predates goes on the end.
		for (const r of mapped) if (!order.includes(key(r))) sorted.push(r);
		return sorted;
	});

	// A new server payload supersedes any local ordering.
	$effect(() => {
		let cancelled = false;
		data.page
			.then((p) => {
				if (cancelled) return;
				serverRows = p.rows;
				total = p.total;
				order = null;
				overrides = {};
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	});

	/** Null while the current filter combination is still loading. */
	let resultCount = $state<number | null>(null);
	$effect(() => {
		resultCount = null;
		let cancelled = false;
		data.page
			.then((p) => !cancelled && (resultCount = p.total))
			.catch(() => !cancelled && (resultCount = 0));
		return () => {
			cancelled = true;
		};
	});

	let loadFailed = $state<string | null>(null);
	$effect(() => {
		data.page.catch((e) => (loadFailed = e instanceof Error ? e.message : String(e)));
	});

	/**
	 * Where a row belongs after being marked, under the active sort.
	 *
	 * Only the orderings Seek can evaluate from data already on the row are
	 * handled. `updated` (Recently watched) is the default and the one that
	 * actually moves on a mark — the row just became the most recently touched.
	 * Sorts keyed on values Floppy computes server-side are left alone rather
	 * than guessed at; the next load corrects them.
	 */
	function reorderAfterMark(k: string) {
		const current = rows;
		const from = current.findIndex((r) => key(r) === k);
		if (from < 0) return;

		const movedRow = current[from];
		const others = current.filter((_, i) => i !== from);

		let to = from;
		if (data.sortKey === 'recently_watched') {
			to = 0;
		} else if (data.sortKey === 'episodes_left') {
			const left = (r: WatchlistRow) => r.left ?? Number.POSITIVE_INFINITY;
			to = others.findIndex((r) => left(r) < left(movedRow));
			if (to < 0) to = current.length - 1;
		} else if (data.sortKey === 'newest_episode' || data.sortKey === 'oldest_episode') {
			/* Marking advances the next episode, so its air date changes and the row
			   genuinely belongs somewhere else — the one case that used to be left
			   sitting in the wrong place until a reload.

			   A row with no next-up sorts last either way: it has no date to compare,
			   and a caught-up show is not what these orderings are for. */
			const at = (r: WatchlistRow) => r.next?.airDate ?? null;
			const mine = at(movedRow);
			if (mine === null) {
				to = current.length - 1;
			} else {
				const newest = data.sortKey === 'newest_episode';
				to = others.findIndex((r) => {
					const theirs = at(r);
					if (theirs === null) return true;
					return newest ? theirs < mine : theirs > mine;
				});
				if (to < 0) to = current.length - 1;
			}
		} else {
			// Alphabetical and total-episodes key on things marking cannot change.
			return;
		}

		if (to === from) return;
		const keys = current.map(key);
		const [moved] = keys.splice(from, 1);
		keys.splice(to, 0, moved);
		order = keys;
	}

	/* No anime segment. Floppy files anime inside the TV library, so a third tab
	   would sit empty, and separating it was dropped rather than pursued — see
	   BACKLOG.md. */
	const SEGMENTS: { id: MediaType; label: string }[] = [
		{ id: 'tv', label: 'TV Shows' },
		{ id: 'movie', label: 'Movies' }
	];

	const key = (r: WatchlistRow) => `${r.source}:${r.mediaId}`;

	function setRow(k: string, row: WatchlistRow) {
		overrides = { ...overrides, [k]: row };
	}

	/* ── Mark + undo (§4.2, §4.3) ─────────────────────────────────────────── */

	type Pending = {
		rowKey: string;
		/** The episode actually written — what undo must reverse. Null for a
		 *  movie, which is addressed by id alone. */
		marked: { season: number; episode: number } | null;
		snapshot: WatchlistRow;
		/** Undo has to put the row back where it was, not just restore its data. */
		orderBefore: string[] | null;
		title: string;
		label: string;
	};

	let toast = $state<Pending | null>(null);
	let undoBusy = $state(false);
	let inFlight = $state<Set<string>>(new Set());

	/* Writes run one at a time.
	   Swiping several rows quickly used to fire the marks in parallel, and each
	   one costs a write plus a re-read on the server. Queuing them keeps a burst
	   of taps from turning into a burst of concurrent Floppy work — the UI is
	   already optimistic, so nothing visible waits on the queue. */
	let writeQueue: Promise<unknown> = Promise.resolve();
	function enqueue<T>(job: () => Promise<T>): Promise<T> {
		const next = writeQueue.then(job, job);
		writeQueue = next.catch(() => {});
		return next;
	}

	function setInFlight(k: string, on: boolean) {
		const next = new Set(inFlight);
		if (on) next.add(k);
		else next.delete(k);
		inFlight = next;
	}

	function patchRow(k: string, patch: Partial<WatchlistRow>) {
		const current = rows.find((r) => key(r) === k);
		if (current) setRow(k, { ...current, ...patch });
	}

	async function onmark(row: WatchlistRow) {
		/* A movie has no next episode, so "nothing next" cannot gate it the way it
		   gates a show — an unwatched film is exactly the case worth marking. */
		const isMovie = row.mediaType === 'movie';
		const movieUnwatched = isMovie && row.progress < (row.maxProgress ?? 1);
		if (!row.next && !movieUnwatched) return;

		const k = key(row);
		if (inFlight.has(k)) return;

		const snapshot = { ...row, next: row.next ? { ...row.next } : null };
		const orderBefore = order ? [...order] : null;
		const marked = row.next ? { season: row.next.season, episode: row.next.episode } : null;
		const label = marked
			? `S${String(marked.season).padStart(2, '0')}E${String(marked.episode).padStart(2, '0')}`
			: 'Watched';

		haptic();
		setInFlight(k, true);

		// Optimistic: the counts move now. The episode pill is left alone until
		// the server names the next one — guessing episode+1 breaks on the
		// absolute-numbered shows in this library (§12.4).
		patchRow(k, {
			progress: row.progress + 1,
			left: row.left === null ? null : Math.max(0, row.left - 1)
		});

		try {
			const res = await enqueue(() =>
				fetch('/api/watch', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						source: row.source,
						mediaId: row.mediaId,
						mediaType: row.mediaType,
						title: row.title,
						season: marked?.season,
						episode: marked?.episode
					})
				})
			);

			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			const body = await res.json();

			// The server re-read the show row, so this is the real next-up rather
			// than a guess. If the refresh failed the optimistic counts stand and
			// the row corrects itself on the next load.
			if (body.row) setRow(k, body.row);
			reorderAfterMark(k);

			toast = { rowKey: k, marked, snapshot, orderBefore, title: row.title, label };
		} catch (err) {
			// Roll the row back to exactly what it was; nothing was recorded, or we
			// cannot prove it was, and the user needs to see the truth either way.
			setRow(k, snapshot);
			note = `Could not mark ${row.title} ${label} — ${err instanceof Error ? err.message : err}`;
		} finally {
			setInFlight(k, false);
		}
	}

	async function onundo() {
		if (!toast || undoBusy) return;
		undoBusy = true;
		const t = toast;

		try {
			const res = await enqueue(() =>
				fetch('/api/watch', {
					method: 'DELETE',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						source: t.snapshot.source,
						mediaId: t.snapshot.mediaId,
						mediaType: t.snapshot.mediaType,
						title: t.snapshot.title,
						season: t.marked?.season,
						episode: t.marked?.episode
					})
				})
			);
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			const body = await res.json();

			// Prefer the server's re-read; fall back to the pre-swipe snapshot if
			// the refresh failed, since the play itself is confirmed removed.
			setRow(t.rowKey, body.row ?? t.snapshot);
			order = t.orderBefore;
			toast = null;
		} catch (err) {
			note = `Undo failed — ${err instanceof Error ? err.message : err}. The play is still recorded.`;
			toast = null;
		} finally {
			undoBusy = false;
		}
	}

	function onsegment(id: MediaType) {
		if (id === data.mediaType) return;
		// Optimistic edits belong to the segment that produced them.
		overrides = {};
		toast = null;
		goto(`/?type=${id}`, { noScroll: true });
	}



	const notBuilt = (what: string) => () => (note = `${what} — not built yet (build order §13).`);

	/* ── Sort (§4.5) ───────────────────────────────────────────────────────
	   The chosen key is persisted server-side per media type, so it survives a
	   relaunch and applies on the first server render rather than after hydrate. */
	const SORT_OPTIONS: { key: SortKey; label: string }[] = [
		{ key: 'recently_watched', label: 'Recently watched' },
		{ key: 'newest_episode', label: 'Newest episode' },
		{ key: 'oldest_episode', label: 'Oldest episode' },
		{ key: 'alphabetical', label: 'Alphabetical' },
		{ key: 'total_episodes', label: 'Total episodes' },
		{ key: 'episodes_left', label: 'Episodes left' }
	];

	let sortOpen = $state(false);
	let filterOpen = $state(false);

	/* Filters are URL state, so back/forward work and a filtered view is
	   shareable between segments. */
	function applyFilters(f: Filters) {
		const params = new URLSearchParams();
		if (data.mediaType !== 'tv') params.set('type', data.mediaType);
		if (f.status !== 'in_progress') params.set('status', f.status);
		if (f.company !== 'all') params.set('company', f.company);
		for (const s of f.services) params.append('service', s);
		overrides = {};
		goto(`/${params.toString() ? `?${params}` : ''}`, { noScroll: true, keepFocus: true });
	}

	const filtersActive = $derived(
		data.filters.status !== 'in_progress' ||
			data.filters.company !== 'all' ||
			data.filters.services.length > 0
	);

	async function chooseSort(key: string) {
		sortOpen = false;
		if (key === data.sortKey) return;
		try {
			await fetch('/api/prefs', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sort: { [data.mediaType]: key } })
			});
		} catch {
			// Persisting is best-effort; the re-fetch below still applies it now.
		}
		overrides = {};
		await invalidateAll();
	}

	/* §4.1's two destinations, now both real. The pill opens a sheet over the
	   list; everything else in the row navigates to the show. */
	let sheetRow = $state<WatchlistRow | null>(null);

	function openShow(row: WatchlistRow) {
		// A film has its own page; the show route is built around seasons.
		goto(`/${row.mediaType === 'movie' ? 'movie' : 'show'}/${row.source}/${row.mediaId}`);
	}

	function openEpisode(row: WatchlistRow) {
		if (!row.next) return;
		sheetRow = row;
	}

	function markFromSheet() {
		const row = sheetRow;
		sheetRow = null;
		if (row) onmark(row);
	}
</script>

<div class="app">
	<header>
		<div class="segments" role="tablist">
			{#each SEGMENTS as seg (seg.id)}
				<button
					role="tab"
					aria-selected={data.mediaType === seg.id}
					class:active={data.mediaType === seg.id}
					onclick={() => onsegment(seg.id)}>{seg.label}</button
				>
			{/each}
		</div>

		<button class="sort" onclick={() => (sortOpen = true)} aria-label="Sort">
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">
				<path d="M4 7h16M6.5 12h11M10 17h4" />
			</svg>
		</button>

		<button class="sort" class:on={filtersActive} onclick={() => (filterOpen = true)} aria-label="Filter">
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
				<path d="M3 5h18l-7 8v6l-4 2v-8z" />
			</svg>
		</button>

	</header>

	<main>
		{#await data.page}
			<ul class="rows">
				{#each Array(6) as _, i (i)}
					<li><Skeleton height="122px" radius={16} /></li>
				{/each}
			</ul>
		{:then _resolved}
		{#if loadFailed}
			<div class="empty">
				<h2>Can't reach Floppy</h2>
				<p>{loadFailed}</p>
			</div>
		{:else if rows.length === 0}
			<div class="empty">
				<h2>Nothing here</h2>
				{#if data.mediaType === 'movie'}
					<p>Your Floppy movie library is empty — 0 movies tracked under any status.</p>
				{:else if filtersActive}
					<p>Nothing matches these filters. <button class="link" onclick={() => applyFilters({ status: 'in_progress', company: 'all', services: [] })}>Reset them</button>.</p>
				{:else}
					<p>No shows in progress with an unwatched episode.</p>
				{/if}
			</div>
		{:else}
			<!-- animate: moves a row to its new position instead of teleporting it,
			     which is what makes the re-sort legible rather than confusing. -->
			<ul class="rows">
				{#each rows as row (key(row))}
					<li animate:flip={{ duration: prefersReducedMotion.current ? 0 : 320 }}>
					<WatchRow
						{row}
						markDirection={data.markDirection}
						pending={inFlight.has(key(row))}
						{onmark}
						onepisode={openEpisode}
						onshow={openShow}
					/>
					</li>
				{/each}
			</ul>
			<p class="count-note tnum">{rows.length} of {total}</p>
		{/if}
		{:catch err}
			<div class="empty"><h2>Can't reach Floppy</h2><p>{err.message}</p></div>
		{/await}
	</main>

	<button class="fab" onclick={() => goto('/search')} aria-label="Search">
		<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2">
			<path d="M12 5v14M5 12h14" stroke-linecap="round" />
		</svg>
	</button>

	<TabBar current="watchlist" />

	{#if filterOpen}
		<FilterSheet
			filters={data.filters}
			subscribed={data.subscribed}
			showCompany={data.companyTracking}
			{resultCount}
			onchange={applyFilters}
			onclose={() => (filterOpen = false)}
		/>
	{/if}

	{#if sortOpen}
		<SortSheet
			current={data.sortKey}
			options={SORT_OPTIONS}
			onchange={chooseSort}
			onclose={() => (sortOpen = false)}
		/>
	{/if}

	{#if sheetRow?.next}
		<EpisodeSheet
			showTitle={sheetRow.title}
			source={sheetRow.source}
			mediaId={sheetRow.mediaId}
			season={sheetRow.next.season}
			episode={sheetRow.next.episode}
			marking={inFlight.has(key(sheetRow))}
			onmark={markFromSheet}
			onclose={() => (sheetRow = null)}
		/>
	{/if}

	{#if toast}
		<UndoToast
			message="Marked watched"
			detail={`${toast.title} · ${toast.label}`}
			busy={undoBusy}
			{onundo}
			ondismiss={() => (toast = null)}
		/>
	{:else if note}
		<div class="note" role="status">
			<span>{note}</span>
			<button onclick={() => (note = null)} aria-label="Dismiss">×</button>
		</div>
	{/if}
</div>

<style>
	.app {
		min-height: 100dvh;
		padding-top: var(--safe-t);
	}

	header {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		padding: 8px var(--gutter);
		padding-top: calc(8px + var(--header-top));
		margin-top: calc(-1 * var(--safe-t));
		background: var(--bg);
	}

	.sort {
		flex: none;
		display: grid;
		place-items: center;
		width: 38px;
		height: var(--tap);
		border-radius: 11px;
		color: var(--text-dim);
	}
	.sort:last-of-type {
		margin-right: -8px;
	}
	/* The accent marks that the list is narrowed — otherwise a filtered
	   watchlist looks like a short library. */
	.sort.on {
		color: var(--signal-solid);
	}

	.segments {
		display: flex;
		flex: 1;
		gap: 2px;
		padding: 3px;
		border-radius: 11px;
		background: var(--surface);
	}
	.segments button {
		flex: 1;
		min-height: 38px;
		border-radius: 9px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-dim);
		transition: background 140ms ease, color 140ms ease;
	}
	.segments button.active {
		background: var(--surface-raised);
		color: var(--text);
	}

	main {
		padding: 4px var(--gutter) 0;
		padding-bottom: calc(var(--tabbar-h) + var(--safe-b) + 88px);
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 8px 0 0;
		padding: 0;
		list-style: none;
	}

	.count-note {
		margin: 16px 0 0;
		text-align: center;
		font-size: 12px;
		color: var(--text-dim);
	}

	.empty {
		margin-top: 22vh;
		text-align: center;
		padding: 0 8px;
	}
	.empty h2 {
		margin: 0 0 8px;
		font-size: 17px;
	}
	.empty p {
		margin: 0;
		font-size: 14px;
		line-height: 1.5;
		color: var(--text-dim);
	}
	.link {
		color: var(--signal-solid);
		font-weight: 600;
		text-decoration: underline;
	}
	.fab {
		position: fixed;
		right: var(--gutter);
		bottom: calc(var(--tabbar-h) + var(--safe-b) + 16px);
		z-index: 40;
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--signal);
		color: #fff;
		/* Derived from the accent rather than fixed: this was violet, so picking
		   any other accent left the button glowing the previous one. */
		box-shadow: 0 8px 24px color-mix(in srgb, var(--signal-solid) 34%, transparent);
	}

	.note {
		position: fixed;
		left: var(--gutter);
		right: var(--gutter);
		bottom: calc(var(--tabbar-h) + var(--safe-b) + 12px);
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 8px 12px 16px;
		border-radius: var(--radius);
		background: var(--surface-raised);
		box-shadow: var(--shadow-lg);
		font-size: 13.5px;
	}
	.note span {
		flex: 1;
	}
	.note button {
		flex: none;
		width: var(--tap);
		height: var(--tap);
		font-size: 22px;
		color: var(--text-dim);
	}
</style>
