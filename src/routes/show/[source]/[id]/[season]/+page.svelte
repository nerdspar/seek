<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EpisodeSheet from '$lib/components/EpisodeSheet.svelte';
	import UndoToast from '$lib/components/UndoToast.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import ArrEpisodeControl from '$lib/components/ArrEpisodeControl.svelte';
	import InteractiveSearchSheet from '$lib/components/InteractiveSearchSheet.svelte';
	import FileActionsSheet from '$lib/components/FileActionsSheet.svelte';
	import SeasonManageSheet from '$lib/components/SeasonManageSheet.svelte';
	import { haptic } from '$lib/haptics';
	import { touchWatchlist } from '$lib/dirty';
	import { queuedWrite } from '$lib/queue.svelte';
	import { epLabel, formatAirDate } from '$lib/format';
	import { notify } from '$lib/notices.svelte';
	import { loadArrStatus, arrManageOn } from '$lib/arr.svelte';
	import { navigating } from '$app/state';
	import { episodeState, downloadingEpisodes, type DlState } from '$lib/arrClient';
	import type { ArrEpisode, ArrFile } from '$lib/server/arr';
	import type { EpisodeRow, SeasonDetail } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/* ── Sonarr download state, merged onto Floppy's episode rows ───────────────
	   Matched by air date server-side (see /api/arr/episodes), so shows that TMDB
	   and TVDB number differently — absolute-numbered anime, re-split seasons like
	   Bake Off — line up correctly. The map is keyed by the Floppy episode number
	   the page renders by; `arrEpisodeIds` are the real Sonarr ids, for the
	   season-level search/monitor actions. Loaded only when management is on. */
	let arrEpisodes = $state<Map<number, ArrEpisode>>(new Map());
	let arrEpisodeIds = $state<number[]>([]);
	/* The show:season the loaded episodes belong to; `arrReady` matches it against
	   the current route so a stale season never shows its controls. */
	let arrKey = $state<string | null>(null);
	let downloading = $state<Map<number, number>>(new Map());
	let arrSeasonMonitored = $state<boolean | null>(null);
	let seasonBusy = $state(false);
	let interactive = $state<{ episodeId?: number } | null>(null);
	let fileSheet = $state<{ ep: EpisodeRow; file: ArrFile; id: number } | null>(null);
	let fileBusy = $state(false);

	const manageOn = $derived(arrManageOn('tv'));

	async function refreshArr() {
		if (!arrManageOn('tv')) return;
		try {
			const [epsRes, qRes] = await Promise.all([
				fetch(`/api/arr/episodes?tmdbId=${encodeURIComponent(data.mediaId)}&source=${encodeURIComponent(data.source)}&season=${data.seasonNumber}`),
				fetch('/api/arr/queue')
			]);
			if (epsRes.ok) {
				const body = (await epsRes.json()) as {
					inLibrary: boolean;
					seasonMonitored: boolean | null;
					episodeIds?: number[];
					episodes: ArrEpisode[];
				};
				const m = new Map<number, ArrEpisode>();
				for (const e of body.episodes) m.set(e.episodeNumber, e);
				arrEpisodes = m;
				arrEpisodeIds = body.episodeIds ?? [];
				arrSeasonMonitored = body.seasonMonitored ?? null;
				arrKey = `${data.mediaId}:${data.seasonNumber}`;
			}
			if (qRes.ok) {
				const q = (await qRes.json()) as { sonarr: Parameters<typeof downloadingEpisodes>[0] };
				downloading = downloadingEpisodes(q.sonarr ?? []);
			}
		} catch {
			/* a down Sonarr just means no download controls */
		}
	}

	const arrOf = (episodeNumber: number) => arrEpisodes.get(episodeNumber);
	const downloadingIds = $derived(new Set(downloading.keys()));
	const aired = (ep: EpisodeRow) => (ep.airDate ? Date.parse(ep.airDate) <= Date.now() : true);
	function stateOf(ep: EpisodeRow): DlState {
		return episodeState(arrOf(ep.episodeNumber), downloadingIds, aired(ep));
	}

	async function autoSearch(episodeNumber: number) {
		const arrEp = arrOf(episodeNumber);
		if (!arrEp) return;
		try {
			const res = await fetch('/api/arr/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: 'tv', kind: 'episodes', episodeIds: [arrEp.id] })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			haptic();
			void notify(`Searching ${epLabel(data.seasonNumber, episodeNumber)}`);
			setTimeout(refreshArr, 1500);
		} catch (err) {
			note = `Couldn't search — ${err instanceof Error ? err.message : err}`;
		}
	}

	async function searchSeasonAuto() {
		if (seasonBusy || !arrEpisodeIds.length) return;
		seasonBusy = true;
		try {
			// Search exactly the episodes shown (by their real Sonarr ids), not a
			// Sonarr season number — which wouldn't line up for a re-numbered show.
			const res = await fetch('/api/arr/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: 'tv', kind: 'episodes', episodeIds: arrEpisodeIds })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			haptic();
			void notify('Searching the season for missing episodes');
			setTimeout(refreshArr, 1500);
		} catch (err) {
			note = `Couldn't search — ${err instanceof Error ? err.message : err}`;
		} finally {
			seasonBusy = false;
		}
	}

	async function toggleSeasonMonitor() {
		if (seasonBusy || !arrEpisodeIds.length) return;
		const next = !(arrSeasonMonitored ?? true);
		seasonBusy = true;
		arrSeasonMonitored = next;
		try {
			const res = await fetch('/api/arr/monitor', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ episodeIds: arrEpisodeIds, monitored: next })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
		} catch (err) {
			arrSeasonMonitored = !next;
			note = `Couldn't update monitoring — ${err instanceof Error ? err.message : err}`;
		} finally {
			seasonBusy = false;
		}
	}

	function openFile(ep: EpisodeRow) {
		const arrEp = arrOf(ep.episodeNumber);
		if (arrEp?.file) fileSheet = { ep, file: arrEp.file, id: arrEp.file.id };
	}

	async function deleteFile(thenReplace = false) {
		if (!fileSheet || fileBusy) return;
		const { ep, id } = fileSheet;
		if (!thenReplace && !confirm(`Delete the downloaded file for ${epLabel(ep.seasonNumber, ep.episodeNumber)}?`)) return;
		fileBusy = true;
		try {
			const res = await fetch('/api/arr/file', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: 'tv', fileId: id, tmdbId: data.mediaId })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			haptic();
			const arrEp = arrOf(ep.episodeNumber);
			fileSheet = null;
			await refreshArr();
			if (thenReplace && arrEp) interactive = { episodeId: arrEp.id };
		} catch (err) {
			note = `Couldn't delete the file — ${err instanceof Error ? err.message : err}`;
		} finally {
			fileBusy = false;
		}
	}

	/* Re-fetch whenever the show or season changes (this component is reused across
	   season→season and show→show navigation). Resetting first avoids showing the
	   previous season's download state. */
	$effect(() => {
		const id = data.mediaId;
		const season = data.seasonNumber;
		void season;
		let cancelled = false;
		arrEpisodes = new Map();
		arrEpisodeIds = [];
		downloading = new Map();
		arrSeasonMonitored = null;
		(async () => {
			await loadArrStatus();
			if (cancelled || !arrManageOn('tv')) return;
			void id;
			await refreshArr();
		})();
		return () => {
			cancelled = true;
		};
	});

	/** Local edits layered over whatever the streamed season resolves to. */
	let overrides = $state<Record<number, EpisodeRow>>({});
	let inFlight = $state<Set<number>>(new Set());
	let sheetFor = $state<number | null>(null);
	let note = $state<string | null>(null);
	let toast = $state<{ episode: number; label: string; before: EpisodeRow } | null>(null);
	let undoBusy = $state(false);

	const episodesOf = (s: SeasonDetail) => s.episodes.map((e) => overrides[e.episodeNumber] ?? e);
	const watchedIn = (eps: EpisodeRow[]) => eps.filter((e) => e.plays > 0).length;

	/* Only treat the Sonarr data as current when it belongs to this exact show +
	   season, so navigating never flashes the previous season's manage icon (the
	   derived recomputes synchronously, before the reset effect runs). */
	const arrReady = $derived(arrKey === `${data.mediaId}:${data.seasonNumber}`);
	const arrInLibrary = $derived(manageOn && arrReady && arrEpisodes.size > 0);
	const arrHaveCount = $derived([...arrEpisodes.values()].filter((e) => e.hasFile).length);
	let manageOpen = $state(false);

	function setFlight(n: number, on: boolean) {
		const next = new Set(inFlight);
		on ? next.add(n) : next.delete(n);
		inFlight = next;
	}

	const put = (ep: EpisodeRow) => (overrides = { ...overrides, [ep.episodeNumber]: ep });

	async function call(method: 'POST' | 'DELETE', episode: number, title: string) {
		const res = await queuedWrite(
			`watch:tv:${data.mediaId}:${data.seasonNumber}:${episode}`,
			method === 'POST' ? 'add' : 'remove',
			'/api/watch',
			{
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
			}
		);
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

	{#snippet seasonActions()}
		<button
			class="manage"
			class:monitored={arrSeasonMonitored}
			aria-label={arrSeasonMonitored ? 'Season monitored — manage downloads' : 'Manage downloads'}
			onclick={() => (manageOpen = true)}
		>
			<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="6" rx="1.6" /><rect x="3" y="13.5" width="18" height="6" rx="1.6" /><path d="M6.5 7.5h.01M6.5 16.5h.01" /></svg>
		</button>
	{/snippet}

	<PageHeader
		title={season.showTitle ?? season.title}
		subtitle={season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`}
		action={arrInLibrary && !navigating.to ? seasonActions : undefined}
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
				<li>
					<button class="body" onclick={() => (sheetFor = ep.episodeNumber)}>
						<span class="line1">
							<span class="num tnum">{epLabel(ep.seasonNumber, ep.episodeNumber)}</span>
							<span class="title">{ep.title}</span>
						</span>
						{#if ep.airDate}
							<span class="air tnum">{formatAirDate(ep.airDate)}</span>
						{/if}
					</button>

					{#if manageOn && arrReady}
						{@const arrEp = arrOf(ep.episodeNumber)}
						<ArrEpisodeControl
							state={stateOf(ep)}
							percent={arrEp ? (downloading.get(arrEp.id) ?? 0) : 0}
							label={epLabel(ep.seasonNumber, ep.episodeNumber)}
						/>
					{/if}

					<button
						class="check"
						class:watched={ep.plays > 0}
						aria-label={ep.plays > 0 ? `Unmark ${epLabel(ep.seasonNumber, ep.episodeNumber)}` : `Mark ${epLabel(ep.seasonNumber, ep.episodeNumber)} watched`}
						aria-pressed={ep.plays > 0}
						onclick={() => toggle(ep, season.showTitle ?? '')}
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
				arrState={manageOn && arrReady ? stateOf(open) : undefined}
				arrFile={arrOf(open.episodeNumber)?.file ?? null}
				onsearch={() => {
					sheetFor = null;
					autoSearch(open.episodeNumber);
				}}
				oninteractive={() => {
					const id = arrOf(open.episodeNumber)?.id;
					sheetFor = null;
					interactive = { episodeId: id };
				}}
				onfile={() => {
					const ep = open;
					sheetFor = null;
					openFile(ep);
				}}
				onclose={() => (sheetFor = null)}
			/>
		{/if}
	{/if}

	{#if interactive}
		<InteractiveSearchSheet
			mediaType="tv"
			tmdbId={data.mediaId}
			title={season.showTitle ?? season.title}
			episodeId={interactive.episodeId}
			season={data.seasonNumber}
			onclose={() => (interactive = null)}
			ongrabbed={refreshArr}
		/>
	{/if}

	{#if fileSheet}
		<FileActionsSheet
			title={`${season.showTitle ?? season.title} · ${epLabel(fileSheet.ep.seasonNumber, fileSheet.ep.episodeNumber)}`}
			file={fileSheet.file}
			busy={fileBusy}
			onclose={() => (fileSheet = null)}
			ondelete={() => deleteFile(false)}
			onreplace={() => deleteFile(true)}
		/>
	{/if}

	{#if manageOpen}
		<SeasonManageSheet
			title={season.showTitle ?? season.title}
			seasonLabel={season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`}
			haveCount={arrHaveCount}
			total={arrEpisodes.size}
			monitored={arrSeasonMonitored ?? true}
			busy={seasonBusy}
			onmonitor={toggleSeasonMonitor}
			onsearch={() => {
				manageOpen = false;
				searchSeasonAuto();
			}}
			oninteractive={() => {
				manageOpen = false;
				interactive = {};
			}}
			onclose={() => (manageOpen = false)}
		/>
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
		display: grid; grid-template-columns: 1fr auto 52px;
		align-items: center; min-height: 60px;
		border-radius: var(--radius); background: var(--surface);
	}

	.manage {
		display: grid; place-items: center;
		width: var(--tap); height: var(--tap);
		border-radius: 50%; color: var(--text-dim);
	}
	.manage.monitored { color: var(--signal-solid); }

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
		/* Always the rightmost column, so a row whose episode has no download glyph
		   (unmatched / not in Sonarr) keeps the check flush right instead of letting
		   it fall into the empty middle column. */
		grid-column: 3;
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
