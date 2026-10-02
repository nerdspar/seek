<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ManualImportSheet from '$lib/components/ManualImportSheet.svelte';
	import { notify } from '$lib/notices.svelte';
	import { haptic } from '$lib/haptics';
	import { loadArrStatus, arrManageOn } from '$lib/arr.svelte';
	import { queuePercent, formatSize, historyEvent, timeAgo } from '$lib/arrClient';
	import type { ArrQueueItem, ArrHistoryItem, ArrWantedItem, ArrHealth } from '$lib/server/arr';
	import { onMount } from 'svelte';

	/**
	 * The cross-title Activity area (Phase 2): Queue, History, Wanted across both
	 * Sonarr and Radarr. Reached from the Profile header, not the tab bar. Each tab
	 * merges the two services and sorts by what matters for that view. Mutations
	 * (remove/blocklist, retry, search-all) are confirmed and optimistic-light —
	 * they re-fetch rather than guess.
	 */
	type Tab = 'queue' | 'history' | 'wanted';
	let tab = $state<Tab>('queue');
	let on = $state(true);

	let queue = $state<ArrQueueItem[]>([]);
	let history = $state<ArrHistoryItem[]>([]);
	let wanted = $state<ArrWantedItem[]>([]);
	let loading = $state<Record<Tab, boolean>>({ queue: true, history: true, wanted: true });
	let acting = $state<string | null>(null);
	let searchingAll = $state(false);
	let health = $state<ArrHealth[]>([]);
	let resolve = $state<{ mediaType: string; downloadId: string; title: string } | null>(null);

	/** A queue item that grabbed but is stuck needing a manual import. */
	const isBlocked = (q: ArrQueueItem) =>
		!!q.downloadId &&
		(q.trackedState === 'importBlocked' || q.trackedState === 'importPending' || q.trackedState === 'importFailed');

	async function loadHealth() {
		try {
			const r = await fetch('/api/arr/health');
			if (r.ok) health = ((await r.json()) as { issues: ArrHealth[] }).issues ?? [];
		} catch {
			/* health is a nicety — ignore failures */
		}
	}

	async function loadQueue() {
		loading.queue = true;
		try {
			const r = await fetch('/api/arr/queue');
			if (r.ok) {
				const b = (await r.json()) as { sonarr: ArrQueueItem[]; radarr: ArrQueueItem[] };
				queue = [...b.sonarr, ...b.radarr];
			}
		} finally {
			loading.queue = false;
		}
	}
	async function loadHistory() {
		loading.history = true;
		try {
			const r = await fetch('/api/arr/history');
			if (r.ok) {
				const b = (await r.json()) as { sonarr: ArrHistoryItem[]; radarr: ArrHistoryItem[] };
				history = [...b.sonarr, ...b.radarr].sort((a, c) => (c.date ?? '').localeCompare(a.date ?? ''));
			}
		} finally {
			loading.history = false;
		}
	}
	async function loadWanted() {
		loading.wanted = true;
		try {
			const r = await fetch('/api/arr/wanted?kind=missing');
			if (r.ok) {
				const b = (await r.json()) as { sonarr: ArrWantedItem[]; radarr: ArrWantedItem[] };
				wanted = [...b.sonarr, ...b.radarr];
			}
		} finally {
			loading.wanted = false;
		}
	}

	/** A quiet queue refresh (no loading flag) for the live poll. */
	async function pollQueue() {
		try {
			const r = await fetch('/api/arr/queue');
			if (r.ok) {
				const b = (await r.json()) as { sonarr: ArrQueueItem[]; radarr: ArrQueueItem[] };
				queue = [...b.sonarr, ...b.radarr];
			}
		} catch {
			/* a dropped poll is harmless — the next tick retries */
		}
	}

	onMount(async () => {
		await loadArrStatus();
		on = arrManageOn();
		if (!on) return;
		void loadQueue();
		void loadHistory();
		void loadWanted();
		void loadHealth();
	});

	/* Live queue: while the Queue tab is open and the page is visible, poll every
	   5s so download progress ticks without reopening. Stops on tab switch / leaving
	   so it never polls in the background. */
	$effect(() => {
		if (!on || tab !== 'queue') return;
		const id = setInterval(() => {
			if (typeof document === 'undefined' || !document.hidden) void pollQueue();
		}, 5000);
		return () => clearInterval(id);
	});

	async function removeFromQueue(item: ArrQueueItem, blocklist: boolean) {
		const key = `q${item.id}`;
		if (acting === key) return;
		const verb = blocklist ? 'Remove and blocklist' : 'Remove';
		if (!confirm(`${verb} this download?\n\n${item.name ?? item.title}`)) return;
		acting = key;
		try {
			const res = await fetch('/api/arr/queue', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ service: item.service, id: item.id, removeFromClient: true, blocklist })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			haptic();
			queue = queue.filter((q) => !(q.id === item.id && q.service === item.service));
			void notify(blocklist ? 'Removed and blocklisted' : 'Removed from queue');
		} catch (err) {
			void notify(`Couldn't remove — ${err instanceof Error ? err.message : err}`);
		} finally {
			acting = null;
		}
	}

	async function retry(h: ArrHistoryItem) {
		const key = `h${h.id}`;
		if (acting === key) return;
		acting = key;
		try {
			const body =
				h.service === 'sonarr' && h.episodeId != null
					? { mediaType: 'tv', kind: 'episodes', episodeIds: [h.episodeId] }
					: h.service === 'radarr' && h.movieId != null
						? { mediaType: 'movie', kind: 'movie', movieId: h.movieId }
						: null;
			if (!body) throw new Error('Nothing to search');
			const res = await fetch('/api/arr/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			haptic();
			void notify(`Searching ${h.name}`);
			setTimeout(loadQueue, 1500);
		} catch (err) {
			void notify(`Couldn't search — ${err instanceof Error ? err.message : err}`);
		} finally {
			acting = null;
		}
	}

	async function searchWanted(w: ArrWantedItem) {
		const key = `w${w.service}${w.episodeId ?? w.movieId}`;
		if (acting === key) return;
		acting = key;
		try {
			const body =
				w.episodeId != null
					? { mediaType: 'tv', kind: 'episodes', episodeIds: [w.episodeId] }
					: { mediaType: 'movie', kind: 'movie', movieId: w.movieId };
			const res = await fetch('/api/arr/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			haptic();
			void notify(`Searching ${w.name}`);
			setTimeout(loadQueue, 1500);
		} catch (err) {
			void notify(`Couldn't search — ${err instanceof Error ? err.message : err}`);
		} finally {
			acting = null;
		}
	}

	async function searchAll() {
		if (searchingAll) return;
		if (!confirm(`Search for all ${wanted.length} missing items? This queues a lot of searches.`)) return;
		searchingAll = true;
		try {
			const res = await fetch('/api/arr/wanted', { method: 'POST' });
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			haptic();
			void notify('Searching for everything missing');
			setTimeout(loadQueue, 2000);
		} catch (err) {
			void notify(`Couldn't search — ${err instanceof Error ? err.message : err}`);
		} finally {
			searchingAll = false;
		}
	}

	const svcLabel = (s: string | undefined) => (s === 'radarr' ? 'Radarr' : 'Sonarr');
</script>

<PageHeader title="Activity" onback={() => window.history.back()} />

<main>
	{#if !on}
		<p class="empty">Download management is off. Turn it on in Settings.</p>
	{:else}
		{#if health.length}
			<ul class="health">
				{#each health as h (h.service + h.source + h.message)}
					<li class={h.type === 'error' ? 'bad' : 'warn'}>
						<span class="dot" aria-hidden="true"></span>
						<span class="htext">{h.message}</span>
						<span class="hsvc">{svcLabel(h.service)}</span>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="tabs" role="tablist">
			<button role="tab" aria-selected={tab === 'queue'} class:on={tab === 'queue'} onclick={() => (tab = 'queue')}>
				Queue{#if queue.length}<span class="count">{queue.length}</span>{/if}
			</button>
			<button role="tab" aria-selected={tab === 'history'} class:on={tab === 'history'} onclick={() => (tab = 'history')}>History</button>
			<button role="tab" aria-selected={tab === 'wanted'} class:on={tab === 'wanted'} onclick={() => (tab = 'wanted')}>
				Wanted{#if wanted.length}<span class="count">{wanted.length}</span>{/if}
			</button>
		</div>

		{#if tab === 'queue'}
			{#if loading.queue}
				<p class="empty">Loading…</p>
			{:else if !queue.length}
				<p class="empty">Nothing downloading.</p>
			{:else}
				<ul class="rows">
					{#each queue as item ((item.service ?? '') + item.id)}
						{@const pct = queuePercent(item)}
						{@const warn = item.trackedState === 'importBlocked' || item.trackedState === 'importPending' || !!item.warning}
						<li>
							<div class="line1">
								<span class="name">{item.name ?? item.title}</span>
								<span class="svc">{svcLabel(item.service)}</span>
							</div>
							<div class="qbar"><div class="qfill" class:warn style:width={`${pct}%`}></div></div>
							<div class="line2">
								<span class="meta tnum">
									{#if warn && item.warning}<span class="warn-t">{item.warning}</span>
									{:else}{pct}% · {formatSize(item.size - item.sizeleft)} / {formatSize(item.size)}{#if item.timeleft} · {item.timeleft}{/if}{/if}
								</span>
								<div class="qactions">
									{#if isBlocked(item)}
										<button class="mini go" onclick={() => (resolve = { mediaType: item.service === 'radarr' ? 'movie' : 'tv', downloadId: item.downloadId!, title: item.name ?? item.title })}>Resolve</button>
									{/if}
									<button class="mini" disabled={acting === `q${item.id}`} onclick={() => removeFromQueue(item, false)}>Remove</button>
									<button class="mini danger" disabled={acting === `q${item.id}`} onclick={() => removeFromQueue(item, true)}>Block</button>
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if tab === 'history'}
			{#if loading.history}
				<p class="empty">Loading…</p>
			{:else if !history.length}
				<p class="empty">No history yet.</p>
			{:else}
				<ul class="rows">
					{#each history as h (h.service + h.id)}
						{@const ev = historyEvent(h.eventType)}
						<li class="hist">
							<span class="dot {ev.tone}" aria-hidden="true"></span>
							<div class="hbody">
								<span class="name">{h.name}</span>
								<span class="meta tnum">{ev.label}{#if h.quality} · {h.quality}{/if} · {timeAgo(h.date)}</span>
							</div>
							{#if ev.tone === 'bad' && (h.episodeId != null || h.movieId != null)}
								<button class="mini" disabled={acting === `h${h.id}`} onclick={() => retry(h)}>Retry</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			{#if loading.wanted}
				<p class="empty">Loading…</p>
			{:else if !wanted.length}
				<p class="empty">Nothing missing. You're caught up.</p>
			{:else}
				<div class="whead">
					<span class="tnum">{wanted.length} missing</span>
					<button class="searchall" disabled={searchingAll} onclick={searchAll}>{searchingAll ? 'Searching…' : 'Search all'}</button>
				</div>
				<ul class="rows">
					{#each wanted as w (w.service + (w.episodeId ?? w.movieId))}
						<li class="hist">
							<div class="hbody">
								<span class="name">{w.name}</span>
								<span class="meta tnum">{svcLabel(w.service)}{#if w.airDate} · {timeAgo(w.airDate)}{/if}</span>
							</div>
							<button class="icon" aria-label={`Search for ${w.name}`} disabled={acting === `w${w.service}${w.episodeId ?? w.movieId}`} onclick={() => searchWanted(w)}>
								<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	{/if}
</main>

{#if resolve}
	<ManualImportSheet
		mediaType={resolve.mediaType}
		downloadId={resolve.downloadId}
		title={resolve.title}
		onclose={() => (resolve = null)}
		onimported={() => setTimeout(loadQueue, 1500)}
	/>
{/if}

<style>
	main { padding: 0 var(--gutter) calc(var(--safe-b) + 32px); }

	.health { list-style: none; margin: 4px 0 12px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.health li { display: flex; align-items: center; gap: 9px; padding: 9px 12px; border-radius: var(--radius); background: var(--surface); font-size: 12.5px; }
	.health .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
	.health li.warn .dot { background: #ffb545; }
	.health li.bad .dot { background: #e24b4a; }
	.htext { flex: 1; min-width: 0; color: var(--text); }
	.hsvc { flex: none; font-size: 10px; font-weight: 700; color: var(--text-dim); }

	.tabs { display: flex; gap: 6px; margin: 6px 0 14px; }
	.tabs button {
		flex: 1; min-height: 38px; border-radius: 10px;
		background: var(--surface); color: var(--text-dim);
		font-size: 14px; font-weight: 600;
		display: inline-flex; align-items: center; justify-content: center; gap: 6px;
	}
	.tabs button.on { background: var(--signal); color: #fff; }
	.count { font-size: 11px; background: rgb(255 255 255 / 0.25); border-radius: 999px; padding: 0 6px; min-width: 18px; }
	.tabs button:not(.on) .count { background: var(--surface-raised); color: var(--text-dim); }

	.empty { margin: 40px 0; text-align: center; color: var(--text-dim); font-size: 14px; }

	.rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.rows li { border-radius: var(--radius); background: var(--surface); padding: 11px 13px; }

	.line1 { display: flex; align-items: baseline; gap: 8px; }
	.name { font-size: 14px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.svc { font-size: 10px; font-weight: 700; color: var(--text-dim); flex: none; }

	.qbar { height: 5px; border-radius: 3px; background: var(--surface-raised); overflow: hidden; margin: 8px 0 7px; }
	.qfill { height: 100%; border-radius: 3px; background: var(--signal); transition: width 300ms ease; }
	.qfill.warn { background: #ffb545; }
	.line2 { display: flex; align-items: center; gap: 10px; }
	.meta { font-size: 11.5px; color: var(--text-dim); flex: 1; min-width: 0; }
	.warn-t { color: #ffb545; }
	.qactions { display: flex; gap: 6px; flex: none; }
	.mini {
		min-height: 30px; padding: 0 11px; border-radius: 8px;
		background: var(--surface-raised); color: var(--text); font-size: 12px; font-weight: 600;
	}
	.mini.danger { color: #ff7a78; }
	.mini.go { background: var(--signal); color: #fff; }
	.mini:disabled { opacity: 0.5; }

	.hist { display: flex; align-items: center; gap: 11px; }
	.hbody { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
	.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--text-dim); }
	.dot.ok { background: #4fd6b8; }
	.dot.warn { background: #ffb545; }
	.dot.bad { background: #e24b4a; }
	.dot.neutral { background: var(--signal-solid); }

	.whead { display: flex; align-items: center; justify-content: space-between; margin: 0 2px 10px; font-size: 12.5px; color: var(--text-dim); }
	.searchall { min-height: 34px; padding: 0 14px; border-radius: 9px; background: var(--signal); color: #fff; font-size: 13px; font-weight: 600; }
	.searchall:disabled { opacity: 0.6; }

	.icon { display: grid; place-items: center; flex: none; width: 36px; height: 36px; border-radius: 50%; background: var(--surface-raised); color: var(--text-dim); }
	.icon:disabled { opacity: 0.5; }
</style>
