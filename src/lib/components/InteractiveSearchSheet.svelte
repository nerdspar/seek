<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { notify } from '$lib/notices.svelte';
	import { haptic } from '$lib/haptics';
	import {
		formatSize,
		isUsenet,
		arrangeReleases,
		distinctQualities,
		distinctIndexers,
		RELEASE_SORTS,
		type ReleaseSort
	} from '$lib/arrClient';
	import type { ArrRelease } from '$lib/server/arr';
	import { onMount } from 'svelte';

	/**
	 * Interactive (manual) release search for an episode, a season, or a movie.
	 * Fires the release query on mount — it hits indexers and can take 5–30s, so a
	 * spinner carries it — then lets you sort and filter what came back and grab
	 * one. Releases that don't meet the quality profile are flagged with a red
	 * icon (and kept, so you can still override), the way Sonarr/Radarr clients do.
	 *
	 * Usenet-shaped by default (age · grabs, no seeders); a torrent release still
	 * shows its seeders.
	 */
	type Props = {
		mediaType: string;
		tmdbId: string;
		title: string;
		episodeId?: number;
		season?: number;
		onclose: () => void;
		ongrabbed?: () => void;
	};
	let { mediaType, tmdbId, title, episodeId, season, onclose, ongrabbed }: Props = $props();

	let loading = $state(true);
	let error = $state<string | null>(null);
	let releases = $state<ArrRelease[]>([]);
	let expanded = $state<string | null>(null);
	let grabbing = $state<string | null>(null);

	// Sort + filter
	let sortKey = $state<ReleaseSort>('weight');
	let sortDir = $state<'asc' | 'desc'>('asc');
	let onlyApproved = $state(false);
	let qualityFilter = $state<string | null>(null);
	let indexerFilter = $state<string | null>(null);
	let panel = $state<'none' | 'sort' | 'filter'>('none');
	const toggle = (p: 'sort' | 'filter') => (panel = panel === p ? 'none' : p);
	const anyFilter = $derived(onlyApproved || !!qualityFilter || !!indexerFilter);

	const qualities = $derived(distinctQualities(releases));
	const indexers = $derived(distinctIndexers(releases));
	const rejectedCount = $derived(releases.filter((r) => r.rejected).length);
	const visible = $derived(
		arrangeReleases(releases, {
			sort: sortKey,
			dir: sortDir,
			onlyApproved,
			quality: qualityFilter,
			indexer: indexerFilter
		})
	);

	function query(): string {
		const p = new URLSearchParams({ mediaType, tmdbId });
		if (episodeId != null) p.set('episodeId', String(episodeId));
		else if (season != null) p.set('season', String(season));
		return p.toString();
	}

	onMount(async () => {
		try {
			const res = await fetch(`/api/arr/releases?${query()}`);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			releases = body.releases ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	});

	async function grab(r: ArrRelease) {
		if (grabbing) return;
		if (r.rejected && !confirm(`Override and grab a rejected release?\n\n${r.title}`)) return;
		grabbing = r.guid;
		try {
			const res = await fetch('/api/arr/grab', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType, guid: r.guid, indexerId: r.indexerId })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			haptic();
			void notify('Sent to the download client');
			ongrabbed?.();
			onclose();
		} catch (err) {
			void notify(`Couldn't grab — ${err instanceof Error ? err.message : err}`);
		} finally {
			grabbing = null;
		}
	}
</script>

<Sheet label={`Interactive search · ${title}`} scrollable {onclose}>
	<div class="head">
		<h2>Interactive search</h2>
		<p class="sub">{title}</p>
	</div>

	{#if !loading && !error && releases.length}
		<div class="controls">
			<button class="ctl" class:on={panel === 'sort'} aria-label="Sort" onclick={() => toggle('sort')}>
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6v12m0 0 3-3m-3 3-3-3M16 18V6m0 0 3 3m-3-3-3 3" /></svg>
				Sort
			</button>
			<button class="ctl" class:on={panel === 'filter' || anyFilter} aria-label="Filter" onclick={() => toggle('filter')}>
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
				Filter{#if anyFilter}<span class="dot"></span>{/if}
			</button>
		</div>

		{#if panel === 'sort'}
			<div class="menu">
				{#each RELEASE_SORTS as s (s.key)}
					<button class="opt" class:sel={sortKey === s.key} onclick={() => (sortKey = s.key)}>
						<span class="tick">{#if sortKey === s.key}✓{/if}</span>{s.label}
					</button>
				{/each}
				<div class="sep"></div>
				<button class="opt" class:sel={sortDir === 'asc'} onclick={() => (sortDir = 'asc')}>
					<span class="tick">{#if sortDir === 'asc'}✓{/if}</span>Ascending
				</button>
				<button class="opt" class:sel={sortDir === 'desc'} onclick={() => (sortDir = 'desc')}>
					<span class="tick">{#if sortDir === 'desc'}✓{/if}</span>Descending
				</button>
			</div>
		{:else if panel === 'filter'}
			<div class="menu">
				<button type="button" class="row" role="switch" aria-checked={onlyApproved} onclick={() => (onlyApproved = !onlyApproved)}>
					<span class="f-label">Approved only{#if rejectedCount} · {rejectedCount} rejected{/if}</span>
					<span class="toggle" class:on={onlyApproved}><span class="knob"></span></span>
				</button>
				<label class="f-field"><span class="f-label">Quality</span>
					<select bind:value={qualityFilter}>
						<option value={null}>Any</option>
						{#each qualities as q (q)}<option value={q}>{q}</option>{/each}
					</select>
				</label>
				{#if indexers.length > 1}
					<label class="f-field"><span class="f-label">Indexer</span>
						<select bind:value={indexerFilter}>
							<option value={null}>Any</option>
							{#each indexers as ix (ix)}<option value={ix}>{ix}</option>{/each}
						</select>
					</label>
				{/if}
			</div>
		{/if}
	{/if}

	{#if loading}
		<div class="state"><span class="spin" aria-hidden="true"></span><span>Asking your indexers…</span></div>
	{:else if error}
		<div class="state err">Couldn't search — {error}</div>
	{:else if !releases.length}
		<div class="state">No releases found.</div>
	{:else if !visible.length}
		<div class="state">No releases match the filter.</div>
	{:else}
		<ul class="rels">
			{#each visible as r (r.guid)}
				{@const open = expanded === r.guid}
				<li class:rejected={r.rejected}>
					<button class="rel" aria-expanded={open} onclick={() => (expanded = open ? null : r.guid)}>
						<span class="rtop">
							{#if r.rejected}
								<svg class="st bad" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Does not meet profile"><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></svg>
							{:else}
								<svg class="st ok" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Meets profile"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
							{/if}
							<span class="rtitle">{r.title}</span>
						</span>
						<span class="meta tnum">
							{#if r.quality}<span class="q">{r.quality}</span>{/if}
							<span>{formatSize(r.size)}</span>
							<span>{r.age}d</span>
							{#if isUsenet(r)}
								{#if r.grabs != null}<span>{r.grabs} grabs</span>{/if}
							{:else if r.seeders != null}<span class="seed">▲ {r.seeders}</span>{/if}
							<span class="ix">{r.indexer}</span>
						</span>
					</button>

					{#if open}
						<div class="detail">
							<div class="grid">
								{#if r.languages.length}
									<span class="k">Audio</span>
									<span class="v badges">{#each r.languages as l (l)}<span class="badge">{l}</span>{/each}</span>
								{/if}
								<span class="k">Indexer</span><span class="v">{r.indexer}</span>
								{#if r.customFormatScore != null && r.customFormatScore !== 0}
									<span class="k">Format score</span>
									<span class="v" class:pos={r.customFormatScore > 0}>{r.customFormatScore > 0 ? '+' : ''}{r.customFormatScore}</span>
								{/if}
								{#if r.flags.length}<span class="k">Flags</span><span class="v">{r.flags.join(', ')}</span>{/if}
							</div>
							{#if r.rejections.length}
								<ul class="rej">{#each r.rejections as why (why)}<li>{why}</li>{/each}</ul>
							{/if}
							<button class="grab" class:override={r.rejected} disabled={grabbing === r.guid} onclick={() => grab(r)}>
								{grabbing === r.guid ? 'Grabbing…' : r.rejected ? 'Override and grab' : 'Grab'}
							</button>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Sheet>

<style>
	.head { padding: 2px 16px 10px; }
	h2 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.01em; }
	.sub { margin: 2px 0 0; font-size: 13px; color: var(--text-dim); }

	.controls { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 0 12px 10px; }
	.ctl { display: inline-flex; align-items: center; gap: 6px; min-height: 38px; padding: 0 14px; border-radius: 10px; background: var(--surface-raised); color: var(--text); font-size: 13px; font-weight: 600; }
	.ctl.on { background: var(--signal); color: #fff; }
	.ctl .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

	.menu { display: flex; flex-direction: column; gap: 2px; margin: 0 12px 12px; padding: 6px; border-radius: 12px; background: var(--surface-raised); }
	.opt { display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 8px; border-radius: 8px; text-align: left; font-size: 14px; color: var(--text); }
	.opt.sel { color: var(--signal-solid); font-weight: 600; }
	.opt .tick { width: 16px; flex: none; text-align: center; font-size: 13px; }
	.sep { height: 1px; margin: 5px 6px; background: color-mix(in srgb, var(--text) 10%, transparent); }

	.f-field { display: flex; flex-direction: column; gap: 5px; padding: 6px 8px; }
	.f-label { font-size: 12px; font-weight: 600; color: var(--text-dim); }
	.menu select { width: 100%; min-height: 40px; padding: 0 12px; border-radius: 10px; background: var(--surface); color: var(--text); font-size: 14px; }
	.row { display: flex; align-items: center; justify-content: space-between; min-height: 42px; padding: 0 8px; }
	.toggle { position: relative; width: 44px; height: 26px; border-radius: 999px; background: var(--surface-raised); flex: none; transition: background 160ms ease; }
	.toggle.on { background: var(--signal); }
	.knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform 160ms ease; }
	.toggle.on .knob { transform: translateX(18px); }

	.state { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 34px 16px; color: var(--text-dim); font-size: 14px; }
	.state.err { color: var(--text); }
	.spin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--surface-raised); border-top-color: var(--signal-solid); animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.rels { list-style: none; margin: 0; padding: 0 12px; display: flex; flex-direction: column; gap: 8px; }
	.rels li { border-radius: 12px; background: var(--surface-raised); overflow: hidden; }
	.rels li.rejected { opacity: 0.74; }

	.rel { display: flex; flex-direction: column; gap: 6px; width: 100%; padding: 11px 12px; text-align: left; }
	.rtop { display: flex; align-items: flex-start; gap: 8px; }
	.st { flex: none; margin-top: 1px; }
	.st.ok { color: #4fd6b8; }
	.st.bad { color: #e24b4a; }
	.rtitle { font-size: 13px; line-height: 1.35; word-break: break-word; }
	.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11.5px; color: var(--text-dim); padding-left: 25px; }
	.meta .q { color: var(--text); font-weight: 600; }
	.meta .seed { color: #4fd6b8; }
	.meta .ix { margin-left: auto; }

	.detail { padding: 0 12px 12px; }
	.grid { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; font-size: 12.5px; padding: 6px 0 2px; }
	.k { color: var(--text-dim); }
	.v { color: var(--text); }
	.v.pos { color: #4fd6b8; }
	.badges { display: flex; flex-wrap: wrap; gap: 5px; }
	.badge { background: var(--surface); border-radius: 6px; padding: 1px 7px; font-size: 11.5px; }
	.rej { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
	.rej li { font-size: 11.5px; color: #e2a34b; }

	.grab { width: 100%; min-height: 40px; margin-top: 10px; border-radius: 10px; background: var(--signal); color: #fff; font-size: 14px; font-weight: 600; }
	.grab.override { background: var(--surface); color: var(--text); border: 1px solid var(--text-dim); }
	.grab:disabled { opacity: 0.6; }
</style>
