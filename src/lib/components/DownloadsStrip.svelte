<script lang="ts">
	import { notify } from '$lib/notices.svelte';
	import { haptic } from '$lib/haptics';
	import { loadArrOptions, arrOptionsFor } from '$lib/arr.svelte';
	import InteractiveSearchSheet from './InteractiveSearchSheet.svelte';
	import type { ArrSeries } from '$lib/server/arr';
	import { onMount } from 'svelte';

	/**
	 * Series-level download management on the show page — the one place for what
	 * isn't per-episode: the monitored switch, quality profile, root folder, series
	 * type and tags, plus "Search whole series" (Sonarr's SeriesSearch: find every
	 * monitored missing/cutoff-unmet episode and grab the best). Collapsed to a one
	 * line summary by default, because it's management, not the common path.
	 */
	type Props = { tmdbId: string; title: string; series: ArrSeries; onchange: () => void };
	let { tmdbId, title, series, onchange }: Props = $props();

	const SERIES_TYPES = ['standard', 'anime', 'daily'];

	let openPanel = $state(false);
	let busy = $state(false);
	let searching = $state(false);
	let interactive = $state(false);

	const opts = $derived(arrOptionsFor('tv'));
	onMount(() => void loadArrOptions());

	/* Form state, seeded from the series and re-seeded whenever a refresh brings a
	   new one in (but not while the user is mid-edit with the panel open). */
	let monitored = $state(false);
	let qualityProfileId = $state(-1);
	let rootFolderPath = $state('');
	let seriesType = $state('standard');
	let tags = $state<Set<string>>(new Set());
	let newTag = $state('');
	let seeded = false;
	$effect(() => {
		if (openPanel || seeded) return;
		monitored = series.monitored;
		qualityProfileId = series.qualityProfileId;
		rootFolderPath = series.rootFolderPath ?? '';
		seriesType = series.seriesType;
		tags = new Set(opts.tags.filter((t) => series.tags.includes(t.id)).map((t) => t.label));
		if (opts.tags.length || series.tags.length === 0) seeded = true;
	});

	const qualityName = $derived(opts.profiles.find((p) => p.id === series.qualityProfileId)?.name ?? null);
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
				body: JSON.stringify({
					mediaType: 'tv',
					tmdbId,
					monitored,
					qualityProfileId,
					rootFolderPath,
					seriesType,
					tags: [...tags]
				})
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			haptic();
			void notify('Saved download settings');
			seeded = false;
			openPanel = false;
			onchange();
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

<div class="strip">
	<button class="bar" aria-expanded={openPanel} onclick={() => (openPanel = !openPanel)}>
		<svg class="srv" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01" /></svg>
		<span class="label">Downloads · Sonarr</span>
		<span class="summary">{series.monitored ? 'monitored' : 'unmonitored'}{qualityName ? ` · ${qualityName}` : ''}</span>
		<svg class="chev" class:open={openPanel} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
	</button>

	{#if openPanel}
		<div class="panel">
			<button type="button" class="row" role="switch" aria-checked={monitored} onclick={() => (monitored = !monitored)}>
				<span class="flabel">Monitored</span>
				<span class="toggle" class:on={monitored}><span class="knob"></span></span>
			</button>

			<label class="field">
				<span class="flabel">Quality profile</span>
				<select bind:value={qualityProfileId}>
					{#each opts.profiles as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
			</label>
			<label class="field">
				<span class="flabel">Root folder</span>
				<select bind:value={rootFolderPath}>
					{#each opts.rootFolders as rf (rf.path)}<option value={rf.path}>{rf.path}</option>{/each}
				</select>
			</label>
			<label class="field">
				<span class="flabel">Series type</span>
				<select bind:value={seriesType}>
					{#each SERIES_TYPES as t (t)}<option value={t}>{t[0].toUpperCase() + t.slice(1)}</option>{/each}
				</select>
			</label>

			<div class="field">
				<span class="flabel">Tags</span>
				<div class="chips">
					{#each tagLabels as label (label)}
						<button type="button" class="tag" class:on={tags.has(label)} onclick={() => toggleTag(label)}>{label}</button>
					{/each}
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
				<button class="save" disabled={busy || qualityProfileId < 0 || !rootFolderPath} onclick={save}>{busy ? 'Saving…' : 'Save'}</button>
			</div>
		</div>
	{/if}
</div>

{#if interactive}
	<InteractiveSearchSheet {tmdbId} {title} mediaType="tv" season={series.seasons.find((s) => s.seasonNumber > 0)?.seasonNumber} onclose={() => (interactive = false)} ongrabbed={onchange} />
{/if}

<style>
	.strip { margin: 0 0 16px; border-radius: var(--radius); background: var(--surface); overflow: hidden; }
	.bar { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 46px; padding: 0 12px; text-align: left; }
	.srv { color: var(--text-dim); flex: none; }
	.label { font-size: 13px; color: var(--text); }
	.summary { margin-left: auto; font-size: 11.5px; color: var(--signal-solid); }
	.chev { color: var(--text-dim); flex: none; transition: transform 160ms ease; }
	.chev.open { transform: rotate(180deg); }

	.panel { display: flex; flex-direction: column; gap: 12px; padding: 4px 12px 14px; }
	.field { display: flex; flex-direction: column; gap: 6px; }
	.flabel { font-size: 13px; font-weight: 600; color: var(--text-dim); }
	select, input {
		width: 100%; min-height: var(--tap); padding: 0 12px;
		border-radius: 12px; background: var(--surface-raised); color: var(--text); font-size: 15px;
	}
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

	.buttons { display: flex; gap: 8px; flex-wrap: wrap; }
	.ghost { flex: 1; min-width: 120px; min-height: 40px; border-radius: 10px; background: var(--surface-raised); color: var(--text); font-size: 14px; font-weight: 600; }
	.ghost:disabled { opacity: 0.6; }
	.save { flex: 1; min-width: 120px; min-height: 40px; border-radius: 10px; background: var(--signal); color: #fff; font-size: 14px; font-weight: 600; }
	.save:disabled { opacity: 0.6; }
</style>
