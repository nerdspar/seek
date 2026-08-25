<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EpisodeSheet from '$lib/components/EpisodeSheet.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';
	import { haptic } from '$lib/haptics';
	import { epLabel, formatAirDate } from '$lib/format';
	import type { EpisodeRow } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const season = $derived(data.season);

	/* Same overlay pattern as the watchlist: derive from the server payload plus
	   local edits, so the list server-renders and optimistic marks survive. */
	let overrides = $state<Record<number, EpisodeRow>>({});
	const episodes = $derived(season.episodes.map((e) => overrides[e.episodeNumber] ?? e));

	let inFlight = $state<Set<number>>(new Set());
	let sheetFor = $state<number | null>(null);
	let note = $state<string | null>(null);
	let toast = $state<{ episode: number; label: string; before: EpisodeRow } | null>(null);
	let undoBusy = $state(false);

	const watchedCount = $derived(episodes.filter((e) => e.plays > 0).length);
	const unwatched = $derived(episodes.filter((e) => e.plays === 0));

	function setFlight(n: number, on: boolean) {
		const next = new Set(inFlight);
		on ? next.add(n) : next.delete(n);
		inFlight = next;
	}

	function put(ep: EpisodeRow) {
		overrides = { ...overrides, [ep.episodeNumber]: ep };
	}

	async function call(method: 'POST' | 'DELETE', episode: number) {
		const res = await fetch('/api/watch', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				source: season.source,
				mediaId: season.mediaId,
				mediaType: 'tv',
				title: season.showTitle ?? '',
				season: season.seasonNumber,
				episode
			})
		});
		if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
		return res.json();
	}

	/** Tapping the circle toggles. §12.3: a POST appends a play, so an already
	 *  watched episode is unmarked rather than marked twice — deliberate marking
	 *  of a rewatch lives on the sheet's explicit button. */
	async function toggle(ep: EpisodeRow) {
		if (inFlight.has(ep.episodeNumber)) return;
		const before = { ...ep };
		const marking = ep.plays === 0;

		haptic();
		setFlight(ep.episodeNumber, true);
		put({ ...ep, plays: marking ? 1 : 0 });

		try {
			await call(marking ? 'POST' : 'DELETE', ep.episodeNumber);
			if (marking) {
				toast = {
					episode: ep.episodeNumber,
					label: epLabel(ep.seasonNumber, ep.episodeNumber),
					before
				};
			}
		} catch (err) {
			put(before);
			note = `Couldn't update ${epLabel(ep.seasonNumber, ep.episodeNumber)} — ${err instanceof Error ? err.message : err}`;
		} finally {
			setFlight(ep.episodeNumber, false);
		}
	}

	async function undo() {
		if (!toast || undoBusy) return;
		undoBusy = true;
		const t = toast;
		try {
			await call('DELETE', t.episode);
			put(t.before);
			toast = null;
		} catch (err) {
			note = `Undo failed — ${err instanceof Error ? err.message : err}. The play is still recorded.`;
			toast = null;
		} finally {
			undoBusy = false;
		}
	}

	/** Mark everything unwatched in this season. Sequential, not parallel: these
	 *  are appends against one show and Floppy resolves the season row per call,
	 *  so firing them at once invites the duplicate-item errors of §12.1. */
	let bulkRunning = $state(false);
	let bulkDone = $state(0);

	async function markAll() {
		if (bulkRunning || !unwatched.length) return;
		const targets = [...unwatched];
		if (!confirm(`Mark ${targets.length} unwatched episode${targets.length === 1 ? '' : 's'} watched?`)) return;

		bulkRunning = true;
		bulkDone = 0;
		toast = null;
		const failures: number[] = [];

		for (const ep of targets) {
			try {
				await call('POST', ep.episodeNumber);
				put({ ...ep, plays: 1 });
			} catch {
				failures.push(ep.episodeNumber);
			}
			bulkDone += 1;
		}

		bulkRunning = false;
		note = failures.length
			? `Marked ${targets.length - failures.length} of ${targets.length}. Failed: ${failures.map((n) => `E${n}`).join(', ')}`
			: `Marked ${targets.length} episode${targets.length === 1 ? '' : 's'} watched.`;
	}

	const openEpisode = $derived(
		sheetFor === null ? null : episodes.find((e) => e.episodeNumber === sheetFor) ?? null
	);
</script>

<PageHeader
	title={season.showTitle ?? season.title}
	subtitle={season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`}
	onback={() => history.back()}
/>

<main>
	<div class="summary">
		<span class="tnum">{watchedCount}/{episodes.length} watched</span>
		{#if unwatched.length}
			<button class="markall" onclick={markAll} disabled={bulkRunning}>
				{bulkRunning ? `Marking ${bulkDone}/${unwatched.length}…` : 'Mark all watched'}
			</button>
		{/if}
	</div>

	<ul class="episodes">
		{#each episodes as ep (ep.episodeNumber)}
			<li class:busy={inFlight.has(ep.episodeNumber)}>
				<button
					class="check"
					class:watched={ep.plays > 0}
					aria-label={ep.plays > 0 ? `Unmark ${epLabel(ep.seasonNumber, ep.episodeNumber)}` : `Mark ${epLabel(ep.seasonNumber, ep.episodeNumber)} watched`}
					aria-pressed={ep.plays > 0}
					onclick={() => toggle(ep)}
					disabled={inFlight.has(ep.episodeNumber) || bulkRunning}
				>
					{#if ep.plays > 0}
						<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
					{/if}
					{#if ep.plays > 1}<span class="plays tnum">{ep.plays}</span>{/if}
				</button>

				<button class="body" onclick={() => (sheetFor = ep.episodeNumber)}>
					<span class="line1">
						<span class="num tnum">{epLabel(ep.seasonNumber, ep.episodeNumber)}</span>
						<span class="title">{ep.title}</span>
					</span>
					{#if ep.airDate}
						<span class="air tnum">{formatAirDate(ep.airDate)}</span>
					{/if}
				</button>
			</li>
		{/each}
	</ul>
</main>

{#if openEpisode}
	<EpisodeSheet
		showTitle={season.showTitle ?? season.title}
		source={season.source}
		mediaId={season.mediaId}
		season={openEpisode.seasonNumber}
		episode={openEpisode.episodeNumber}
		marking={inFlight.has(openEpisode.episodeNumber)}
		onmark={() => {
			const ep = openEpisode;
			sheetFor = null;
			if (ep) toggle(ep.plays > 0 ? { ...ep, plays: 0 } : ep);
		}}
		onclose={() => (sheetFor = null)}
	/>
{/if}

{#if toast}
	<UndoToast
		message="Marked watched"
		detail={`${season.showTitle ?? season.title} · ${toast.label}`}
		busy={undoBusy}
		onundo={undo}
		ondismiss={() => (toast = null)}
	/>
{:else if note}
	<div class="note" role="status">
		<span>{note}</span>
		<button onclick={() => (note = null)} aria-label="Dismiss">×</button>
	</div>
{/if}

<style>
	main {
		padding: 0 var(--gutter) calc(var(--safe-b) + 32px);
	}

	.summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin: 6px 0 10px;
		font-size: 13px;
		color: var(--text-dim);
	}
	.markall {
		min-height: 36px;
		padding: 0 12px;
		border-radius: 9px;
		background: var(--surface-raised);
		font-size: 13px;
		font-weight: 600;
		color: var(--text);
	}
	.markall:disabled {
		opacity: 0.6;
	}

	.episodes {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.episodes li {
		display: grid;
		grid-template-columns: 52px 1fr;
		align-items: center;
		/* Roomier than the 44px minimum: these get tapped repeatedly while
		   working through a season, and the row itself is the target. */
		min-height: 60px;
		border-radius: var(--radius);
		background: var(--surface);
	}
	.episodes li.busy {
		opacity: 0.6;
	}

	.check {
		position: relative;
		display: grid;
		place-items: center;
		width: 52px;
		height: 60px;
		justify-self: center;
	}
	.check::before {
		content: '';
		position: absolute;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 1.8px solid var(--surface-raised);
	}
	.check.watched::before {
		border-color: transparent;
		background: var(--signal);
	}
	.check svg {
		position: relative;
		color: #fff;
	}
	.plays {
		position: absolute;
		right: 2px;
		bottom: 2px;
		min-width: 14px;
		padding: 0 3px;
		border-radius: 7px;
		background: var(--surface-raised);
		font-size: 9.5px;
		font-weight: 700;
		line-height: 14px;
		color: var(--text-dim);
	}

	.body {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 3px;
		min-height: 60px;
		padding: 10px 14px 10px 2px;
		text-align: left;
		min-width: 0;
	}
	.line1 {
		display: flex;
		gap: 8px;
		min-width: 0;
	}
	.num {
		flex: none;
		font-size: 14.5px;
		font-weight: 600;
		color: var(--text-dim);
	}
	.title {
		font-size: 14.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.air {
		font-size: 11.5px;
		color: var(--text-dim);
	}

	.note {
		position: fixed;
		left: var(--gutter);
		right: var(--gutter);
		bottom: calc(var(--safe-b) + 12px);
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
