<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EpisodeSheet from '$lib/components/EpisodeSheet.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { haptic } from '$lib/haptics';
	import { touchWatchlist } from '$lib/dirty';
	import { epLabel, formatAirDate } from '$lib/format';
	import type { EpisodeRow, SeasonDetail } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Local edits layered over whatever the streamed season resolves to. */
	let overrides = $state<Record<number, EpisodeRow>>({});
	let inFlight = $state<Set<number>>(new Set());
	let sheetFor = $state<number | null>(null);
	let note = $state<string | null>(null);
	let toast = $state<{ episode: number; label: string; before: EpisodeRow } | null>(null);
	let undoBusy = $state(false);

	const episodesOf = (s: SeasonDetail) => s.episodes.map((e) => overrides[e.episodeNumber] ?? e);
	const watchedIn = (eps: EpisodeRow[]) => eps.filter((e) => e.plays > 0).length;

	function setFlight(n: number, on: boolean) {
		const next = new Set(inFlight);
		on ? next.add(n) : next.delete(n);
		inFlight = next;
	}

	const put = (ep: EpisodeRow) => (overrides = { ...overrides, [ep.episodeNumber]: ep });

	async function call(method: 'POST' | 'DELETE', episode: number, title: string) {
		const res = await fetch('/api/watch', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				source: data.source,
				mediaId: data.mediaId,
				mediaType: 'tv',
				title,
				season: data.seasonNumber,
				episode
			})
		});
		if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
		// The list shows next-up and a progress count, both of which just moved.
		touchWatchlist();
		return res.json();
	}

	/** Tapping the circle toggles. §12.3 makes a second POST a second play, so an
	 *  already-watched episode is unmarked rather than marked twice; deliberate
	 *  rewatches go through the sheet's explicit button. */
	async function toggle(ep: EpisodeRow, showTitle: string) {
		if (inFlight.has(ep.episodeNumber)) return;
		const before = { ...ep };
		const marking = ep.plays === 0;

		haptic();
		setFlight(ep.episodeNumber, true);
		put({ ...ep, plays: marking ? 1 : 0 });

		try {
			await call(marking ? 'POST' : 'DELETE', ep.episodeNumber, showTitle);
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

	async function undo(showTitle: string) {
		if (!toast || undoBusy) return;
		undoBusy = true;
		const t = toast;
		try {
			await call('DELETE', t.episode, showTitle);
			put(t.before);
			toast = null;
		} catch (err) {
			note = `Undo failed — ${err instanceof Error ? err.message : err}. The play is still recorded.`;
			toast = null;
		} finally {
			undoBusy = false;
		}
	}

</script>

{#await data.season}
	<PageHeader
		title=""
		subtitle={data.seasonNumber === 0 ? 'Specials' : `Season ${data.seasonNumber}`}
		onback={() => history.back()}
	/>
	<main class="loading">
		<Skeleton height="18px" width="55%" />
		<div class="skrows">
			{#each Array(9) as _, i (i)}
				<Skeleton height="60px" radius={12} />
			{/each}
		</div>
	</main>
{:then season}
	{@const episodes = episodesOf(season)}
	{@const watchedCount = watchedIn(episodes)}
	{@const allWatched = episodes.length > 0 && watchedCount === episodes.length}

	<PageHeader
		title={season.showTitle ?? season.title}
		subtitle={season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`}
		onback={() => history.back()}
	/>

	<main>
		<div class="summary">
			<div class="bar">
				<div class="track">
					<div class="fill" style:width={`${episodes.length ? (watchedCount / episodes.length) * 100 : 0}%`}></div>
				</div>
				<span class="tnum">{watchedCount}/{episodes.length}</span>
			</div>

		</div>

		<ul class="episodes">
			{#each episodes as ep (ep.episodeNumber)}
				<li class:busy={inFlight.has(ep.episodeNumber)}>
					<button class="body" onclick={() => (sheetFor = ep.episodeNumber)}>
						<span class="line1">
							<span class="num tnum">{epLabel(ep.seasonNumber, ep.episodeNumber)}</span>
							<span class="title">{ep.title}</span>
						</span>
						{#if ep.airDate}
							<span class="air tnum">{formatAirDate(ep.airDate)}</span>
						{/if}
					</button>

					<button
						class="check"
						class:watched={ep.plays > 0}
						aria-label={ep.plays > 0 ? `Unmark ${epLabel(ep.seasonNumber, ep.episodeNumber)}` : `Mark ${epLabel(ep.seasonNumber, ep.episodeNumber)} watched`}
						aria-pressed={ep.plays > 0}
						onclick={() => toggle(ep, season.showTitle ?? '')}
						disabled={inFlight.has(ep.episodeNumber)}
					>
						{#if ep.plays > 0}
							<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
						{/if}
						{#if ep.plays > 1}<span class="plays tnum">{ep.plays}</span>{/if}
					</button>
				</li>
			{/each}
		</ul>
	</main>

	{#if sheetFor !== null}
		{@const open = episodes.find((e) => e.episodeNumber === sheetFor)}
		{#if open}
			<EpisodeSheet
				showTitle={season.showTitle ?? season.title}
				source={data.source}
				mediaId={data.mediaId}
				season={open.seasonNumber}
				episode={open.episodeNumber}
				marking={inFlight.has(open.episodeNumber)}
				onmark={() => {
					sheetFor = null;
					toggle(open.plays > 0 ? { ...open, plays: 0 } : open, season.showTitle ?? '');
				}}
				onclose={() => (sheetFor = null)}
			/>
		{/if}
	{/if}

	{#if toast}
		<UndoToast
			message="Marked watched"
			detail={`${season.showTitle ?? season.title} · ${toast.label}`}
			busy={undoBusy}
			onundo={() => undo(season.showTitle ?? '')}
			ondismiss={() => (toast = null)}
		/>
	{/if}
{:catch err}
	<PageHeader title="" onback={() => history.back()} />
	<main><div class="failed"><h2>Couldn't load that season</h2><p>{err.message}</p></div></main>
{/await}

{#if note && !toast}
	<div class="note" role="status">
		<span>{note}</span>
		<button onclick={() => (note = null)} aria-label="Dismiss">×</button>
	</div>
{/if}

<style>
	main { padding: 0 var(--gutter) calc(var(--safe-b) + 32px); }

	.summary {
		display: grid; grid-template-columns: 1fr 52px;
		align-items: center; gap: 12px; margin: 6px 0 12px;
	}
	.bar { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--text-dim); }
	.track { flex: 1; height: 6px; border-radius: 3px; background: var(--surface); overflow: hidden; }
	.fill {
		height: 100%; border-radius: 3px; background: var(--signal);
		transition: width 260ms cubic-bezier(0.22, 1, 0.36, 1);
	}


	.episodes { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
	.episodes li {
		display: grid; grid-template-columns: 1fr 52px;
		align-items: center; min-height: 60px;
		border-radius: var(--radius); background: var(--surface);
	}
	.episodes li.busy { opacity: 0.6; }

	.body {
		display: flex; flex-direction: column; justify-content: center; gap: 3px;
		min-height: 60px; padding: 10px 2px 10px 14px;
		text-align: left; min-width: 0;
	}
	.line1 { display: flex; gap: 8px; min-width: 0; }
	.num { flex: none; font-size: 14.5px; font-weight: 600; color: var(--text-dim); }
	.title { font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.air { font-size: 11.5px; color: var(--text-dim); }

	.check {
		position: relative; display: grid; place-items: center;
		width: 52px; height: 60px; justify-self: center;
	}
	.check::before {
		content: ''; position: absolute; width: 24px; height: 24px;
		border-radius: 50%; border: 1.8px solid var(--surface-raised);
	}
	.check.watched::before { border-color: transparent; background: var(--signal); }
	.check svg { position: relative; color: #fff; }
	.plays {
		position: absolute; right: 4px; bottom: 6px;
		min-width: 14px; padding: 0 3px; border-radius: 7px;
		background: var(--surface-raised);
		font-size: 9.5px; font-weight: 700; line-height: 14px; color: var(--text-dim);
	}

	.loading { display: flex; flex-direction: column; gap: 10px; }
	.skrows { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }

	.failed { margin-top: 22vh; text-align: center; }
	.failed h2 { margin: 0 0 8px; font-size: 17px; }
	.failed p { margin: 0; font-size: 14px; color: var(--text-dim); }

	.note {
		position: fixed; left: var(--gutter); right: var(--gutter);
		bottom: calc(var(--safe-b) + 12px); z-index: 60;
		display: flex; align-items: center; gap: 10px;
		padding: 12px 8px 12px 16px; border-radius: var(--radius);
		background: var(--surface-raised); box-shadow: var(--shadow-lg);
		font-size: 13.5px;
	}
	.note span { flex: 1; }
	.note button { flex: none; width: var(--tap); height: var(--tap); font-size: 22px; color: var(--text-dim); }
</style>
