<script lang="ts">
	import { goto } from '$app/navigation';
	import WatchRow from '$lib/components/WatchRow.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';
	import EpisodeSheet from '$lib/components/EpisodeSheet.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import { haptic } from '$lib/haptics';
	import { load as loadSettings, type Settings } from '$lib/settings';
	import type { MediaType, WatchlistRow } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let settings = $state<Settings>({ markDirection: 'rtl' });
	let note = $state<string | null>(null);

	/* Optimistic edits live in an overlay keyed by row, and the list is derived
	   from the server payload plus that overlay. Holding the rows in $state and
	   filling them from an $effect would render an empty list during SSR —
	   effects do not run on the server — so every cold launch would flash
	   "Nothing here" before hydration. On a home-screen PWA that flash is the
	   first thing you see, and this screen is judged on how fast it appears. */
	let overrides = $state<Record<string, WatchlistRow>>({});
	const rows = $derived(data.rows.map((r) => overrides[key(r)] ?? r));

	$effect(() => {
		settings = loadSettings();
	});

	/* Anime is deliberately NOT a segment. Floppy files it inside the TV library,
	   so a third tab would either sit empty or split the list on a distinction
	   the user does not want while marking. It belongs with the filters (§4.6),
	   alongside status and platform — pending the bucket migration that gives it
	   something to filter on. */
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
		/** The episode actually written — what undo must reverse. */
		marked: { season: number; episode: number };
		snapshot: WatchlistRow;
		title: string;
		label: string;
	};

	let toast = $state<Pending | null>(null);
	let undoBusy = $state(false);
	let inFlight = $state<Set<string>>(new Set());

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
		if (!row.next) return;
		const k = key(row);
		if (inFlight.has(k)) return;

		const snapshot = { ...row, next: row.next ? { ...row.next } : null };
		const marked = { season: row.next.season, episode: row.next.episode };
		const label = `S${String(marked.season).padStart(2, '0')}E${String(marked.episode).padStart(2, '0')}`;

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
			const res = await fetch('/api/watch', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					source: row.source,
					mediaId: row.mediaId,
					mediaType: row.mediaType,
					title: row.title,
					season: marked.season,
					episode: marked.episode
				})
			});

			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			const body = await res.json();

			// The server re-read the show row, so this is the real next-up rather
			// than a guess. If the refresh failed the optimistic counts stand and
			// the row corrects itself on the next load.
			if (body.row) setRow(k, body.row);

			toast = { rowKey: k, marked, snapshot, title: row.title, label };
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
			const res = await fetch('/api/watch', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					source: t.snapshot.source,
					mediaId: t.snapshot.mediaId,
					mediaType: t.snapshot.mediaType,
					title: t.snapshot.title,
					season: t.marked.season,
					episode: t.marked.episode
				})
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			const body = await res.json();

			// Prefer the server's re-read; fall back to the pre-swipe snapshot if
			// the refresh failed, since the play itself is confirmed removed.
			setRow(t.rowKey, body.row ?? t.snapshot);
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

	/* §4.1's two destinations, now both real. The pill opens a sheet over the
	   list; everything else in the row navigates to the show. */
	let sheetRow = $state<WatchlistRow | null>(null);

	function openShow(row: WatchlistRow) {
		goto(`/show/${row.source}/${row.mediaId}`);
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

	</header>

	<main>
		{#if data.error}
			<div class="empty">
				<h2>Can't reach Floppy</h2>
				<p>{data.error}</p>
			</div>
		{:else if rows.length === 0}
			<div class="empty">
				<h2>Nothing here</h2>
				{#if data.mediaType === 'movie'}
					<p>Your Floppy movie library is empty — 0 movies tracked under any status.</p>
				{:else}
					<p>No shows in progress with an unwatched episode.</p>
				{/if}
			</div>
		{:else}
			<ul class="rows">
				{#each rows as row (key(row))}
					<WatchRow
						{row}
						markDirection={settings.markDirection}
						pending={inFlight.has(key(row))}
						{onmark}
						onepisode={openEpisode}
						onshow={openShow}
					/>
				{/each}
			</ul>
			<p class="count-note tnum">{rows.length} of {data.total}</p>
		{/if}
	</main>

	<button class="fab" onclick={() => goto('/search')} aria-label="Search">
		<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2">
			<path d="M12 5v14M5 12h14" stroke-linecap="round" />
		</svg>
	</button>

	<TabBar current="watchlist" />

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
		padding-top: calc(8px + var(--safe-t));
		margin-top: calc(-1 * var(--safe-t));
		background: var(--bg);
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
		box-shadow: 0 8px 24px rgb(91 108 255 / 0.34);
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
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
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
