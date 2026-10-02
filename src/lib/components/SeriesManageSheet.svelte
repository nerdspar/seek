<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { notify } from '$lib/notices.svelte';
	import { haptic } from '$lib/haptics';
	import { loadArrOptions, arrOptionsFor } from '$lib/arr.svelte';
	import InteractiveSearchSheet from './InteractiveSearchSheet.svelte';
	import type { ArrSeries } from '$lib/server/arr';
	import { onMount } from 'svelte';

	/**
	 * Series-level download settings, opened from the show header. The one place
	 * for what isn't per-episode: monitored, quality profile, root folder, series
	 * type, tags, plus "Search whole series" (Sonarr's SeriesSearch) and an
	 * interactive search. Replaces the old inline strip to declutter the page.
	 */
	type Props = { tmdbId: string; title: string; series: ArrSeries; onchange: () => void; onclose: () => void };
	let { tmdbId, title, series, onchange, onclose }: Props = $props();

	const SERIES_TYPES = ['standard', 'anime', 'daily'];

	let busy = $state(false);
	let searching = $state(false);
	let interactive = $state(false);

	const opts = $derived(arrOptionsFor('tv'));
	onMount(() => void loadArrOptions());

	let monitored = $state(false);
	let qualityProfileId = $state(-1);
	let rootFolderPath = $state('');
	let seriesType = $state('standard');
	let tags = $state<Set<string>>(new Set());
	let newTag = $state('');

	/* The sheet is mounted fresh each open, so this seeds once from the series. */
	let primed = false;
	$effect(() => {
		if (primed) return;
		monitored = series.monitored;
		qualityProfileId = series.qualityProfileId;
		rootFolderPath = series.rootFolderPath ?? '';
		seriesType = series.seriesType;
		primed = true;
	});
	/* Tags need the options list (id → label), which arrives separately. */
	let seeded = false;
	$effect(() => {
		if (seeded) return;
		tags = new Set(opts.tags.filter((t) => series.tags.includes(t.id)).map((t) => t.label));
		if (opts.tags.length || series.tags.length === 0) seeded = true;
	});

	const tagLabels = $derived([...new Set([...opts.tags.map((t) => t.label), ...tags])]);

	function toggleTag(label: string) {
		const next = new Set(tags);
		next.has(label) ? next.delete(label) : next.add(label);
		tags = next;
	}
	function addTag() {
		const t = newTag.trim();
		if (t) tags = new Set(tags).add(t);
		newTag = '';
	}

	async function save() {
		if (busy) return;
		busy = true;
		try {
			const res = await fetch('/api/arr/edit', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: 'tv', tmdbId, monitored, qualityProfileId, rootFolderPath, seriesType, tags: [...tags] })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			haptic();
			void notify('Saved download settings');
			onchange();
			onclose();
		} catch (err) {
			void notify(`Couldn't save — ${err instanceof Error ? err.message : err}`);
		} finally {
			busy = false;
		}
	}

	async function searchSeries() {
		if (searching) return;
		searching = true;
		try {
			const res = await fetch('/api/arr/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: 'tv', tmdbId, kind: 'series' })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			haptic();
			void notify(`Searching ${title} for missing episodes`);
		} catch (err) {
			void notify(`Couldn't search — ${err instanceof Error ? err.message : err}`);
		} finally {
			searching = false;
		}
	}
</script>

<Sheet label={`Manage ${title} downloads`} scrollable {onclose}>
	<div class="body">
		<h2>Downloads</h2>
		<p class="sub">{title} · Sonarr</p>

		<button type="button" class="row" role="switch" aria-checked={monitored} onclick={() => (monitored = !monitored)}>
			<span class="flabel">Monitored</span>
			<span class="toggle" class:on={monitored}><span class="knob"></span></span>
		</button>

		<label class="field"><span class="flabel">Quality profile</span>
			<select bind:value={qualityProfileId}>{#each opts.profiles as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select>
		</label>
		<label class="field"><span class="flabel">Root folder</span>
			<select bind:value={rootFolderPath}>{#each opts.rootFolders as rf (rf.path)}<option value={rf.path}>{rf.path}</option>{/each}</select>
		</label>
		<label class="field"><span class="flabel">Series type</span>
			<select bind:value={seriesType}>{#each SERIES_TYPES as t (t)}<option value={t}>{t[0].toUpperCase() + t.slice(1)}</option>{/each}</select>
		</label>

		<div class="field"><span class="flabel">Tags</span>
			<div class="chips">
				{#each tagLabels as label (label)}<button type="button" class="tag" class:on={tags.has(label)} onclick={() => toggleTag(label)}>{label}</button>{/each}
				{#if !tagLabels.length}<span class="muted">No tags yet</span>{/if}
			</div>
			<div class="newtag">
				<input placeholder="New tag…" bind:value={newTag} onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())} />
				<button type="button" class="addtag" onclick={addTag} disabled={!newTag.trim()}>Add</button>
			</div>
		</div>

		<div class="buttons">
			<button class="ghost" disabled={searching} onclick={searchSeries}>{searching ? 'Searching…' : 'Search series'}</button>
			<button class="ghost" onclick={() => (interactive = true)}>Interactive…</button>
		</div>
		<button class="save" disabled={busy || qualityProfileId < 0 || !rootFolderPath} onclick={save}>{busy ? 'Saving…' : 'Save'}</button>
	</div>
</Sheet>

{#if interactive}
	<InteractiveSearchSheet {tmdbId} {title} mediaType="tv" season={series.seasons.find((s) => s.seasonNumber > 0)?.seasonNumber} onclose={() => (interactive = false)} ongrabbed={onchange} />
{/if}

<style>
	.body { padding: 4px 16px 8px; display: flex; flex-direction: column; gap: 12px; }
	h2 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.01em; }
	.sub { margin: 0; color: var(--text-dim); font-size: 13px; }
	.field { display: flex; flex-direction: column; gap: 6px; }
	.flabel { font-size: 13px; font-weight: 600; color: var(--text-dim); }
	select, input { width: 100%; min-height: var(--tap); padding: 0 12px; border-radius: 12px; background: var(--surface-raised); color: var(--text); font-size: 15px; }
	.row { display: flex; align-items: center; justify-content: space-between; min-height: var(--tap); }
	.toggle { position: relative; width: 46px; height: 28px; border-radius: 999px; background: var(--surface-raised); flex: none; transition: background 160ms ease; }
	.toggle.on { background: var(--signal); }
	.knob { position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; transition: transform 160ms ease; }
	.toggle.on .knob { transform: translateX(18px); }
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.tag { padding: 7px 12px; border-radius: 999px; background: var(--surface-raised); color: var(--text); font-size: 14px; }
	.tag.on { background: var(--signal); color: #fff; }
	.muted { color: var(--text-dim); font-size: 13px; }
	.newtag { display: flex; gap: 8px; }
	.newtag input { flex: 1; }
	.addtag { padding: 0 16px; border-radius: 12px; background: var(--surface-raised); color: var(--text); font-weight: 600; }
	.addtag:disabled { opacity: 0.5; }
	.buttons { display: flex; gap: 8px; }
	.ghost { flex: 1; min-height: 44px; border-radius: 12px; background: var(--surface-raised); color: var(--text); font-size: 14px; font-weight: 600; }
	.ghost:disabled { opacity: 0.6; }
	.save { min-height: 48px; border-radius: 14px; background: var(--signal); color: #fff; font-size: 16px; font-weight: 600; }
	.save:disabled { opacity: 0.6; }
</style>
