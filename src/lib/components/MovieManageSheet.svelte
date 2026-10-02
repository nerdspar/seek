<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { notify } from '$lib/notices.svelte';
	import { haptic } from '$lib/haptics';
	import { loadArrOptions, arrOptionsFor } from '$lib/arr.svelte';
	import { formatSize, audioBadges } from '$lib/arrClient';
	import InteractiveSearchSheet from './InteractiveSearchSheet.svelte';
	import FileActionsSheet from './FileActionsSheet.svelte';
	import type { ArrMovie } from '$lib/server/arr';
	import { onMount } from 'svelte';

	/**
	 * Radarr management for a movie, opened from the movie header — the sheet
	 * equivalent of the show page's SeriesManageSheet. Status (downloaded / missing
	 * / downloading), settings, automatic + interactive search, and file actions
	 * for the one title. The page owns the fetch and passes the movie in; mutations
	 * call onchange so the page (and its header icon) refresh.
	 */
	type Props = {
		tmdbId: string;
		title: string;
		movie: ArrMovie;
		percent: number | null;
		onchange: () => void;
		onclose: () => void;
	};
	let { tmdbId, title, movie, percent, onchange, onclose }: Props = $props();

	const MIN_AVAIL = [
		{ value: 'announced', label: 'Announced' },
		{ value: 'inCinemas', label: 'In cinemas' },
		{ value: 'released', label: 'Released' }
	];

	let busy = $state(false);
	let searching = $state(false);
	let interactive = $state(false);
	let fileOpen = $state(false);
	let fileBusy = $state(false);

	const opts = $derived(arrOptionsFor('movie'));
	onMount(() => void loadArrOptions());

	let monitored = $state(false);
	let qualityProfileId = $state(-1);
	let rootFolderPath = $state('');
	let minimumAvailability = $state('released');
	let tags = $state<Set<string>>(new Set());
	let newTag = $state('');

	/* The sheet is mounted fresh each open, so this seeds once from the movie. */
	let primed = false;
	$effect(() => {
		if (primed) return;
		monitored = movie.monitored;
		qualityProfileId = movie.qualityProfileId;
		rootFolderPath = movie.rootFolderPath ?? '';
		minimumAvailability = movie.minimumAvailability;
		primed = true;
	});
	let seeded = false;
	$effect(() => {
		if (seeded) return;
		tags = new Set(opts.tags.filter((t) => movie.tags.includes(t.id)).map((t) => t.label));
		if (opts.tags.length || movie.tags.length === 0) seeded = true;
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
				body: JSON.stringify({ mediaType: 'movie', tmdbId, monitored, qualityProfileId, rootFolderPath, minimumAvailability, tags: [...tags] })
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

	async function search() {
		if (searching) return;
		searching = true;
		try {
			const res = await fetch('/api/arr/search', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: 'movie', tmdbId, kind: 'movie' })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			haptic();
			void notify(`Searching for ${title}`);
			setTimeout(onchange, 1500);
		} catch (err) {
			void notify(`Couldn't search — ${err instanceof Error ? err.message : err}`);
		} finally {
			searching = false;
		}
	}

	async function deleteFile(thenReplace = false) {
		if (!movie.file || fileBusy) return;
		if (!thenReplace && !confirm(`Delete the downloaded file for ${title}?`)) return;
		fileBusy = true;
		try {
			const res = await fetch('/api/arr/file', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: 'movie', fileId: movie.file.id, tmdbId })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			haptic();
			fileOpen = false;
			onchange();
			if (thenReplace) interactive = true;
		} catch (err) {
			void notify(`Couldn't delete the file — ${err instanceof Error ? err.message : err}`);
		} finally {
			fileBusy = false;
		}
	}
</script>

<Sheet label={`Manage ${title} downloads`} scrollable {onclose}>
	<div class="body">
		<h2>Downloads</h2>
		<p class="sub">{title} · Radarr</p>

		<div class="statusrow">
			{#if movie.hasFile && movie.file}
				<button class="status have" onclick={() => (fileOpen = true)}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
					<span>{movie.file.quality ?? 'Downloaded'}</span>
					{#each audioBadges(movie.file) as a (a)}<span class="audio">{a}</span>{/each}
					<span class="size tnum">{formatSize(movie.file.size)}</span>
				</button>
			{:else if percent !== null}
				<span class="status dl"><span class="spin"></span>Downloading {percent}%</span>
			{:else}
				<span class="status missing">Not downloaded</span>
				<button class="icon" disabled={searching} aria-label="Search for this movie" onclick={search}>
					<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
				</button>
				<button class="icon" aria-label="Interactive search" onclick={() => (interactive = true)}>
					<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="3.4" /><path d="M4.5 19a5.5 5.5 0 0 1 9.7-3.2" /><circle cx="17.5" cy="16.5" r="2.6" /><path d="m21 20-1.7-1.7" /></svg>
				</button>
			{/if}
		</div>

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
		<label class="field"><span class="flabel">Minimum availability</span>
			<select bind:value={minimumAvailability}>{#each MIN_AVAIL as m (m.value)}<option value={m.value}>{m.label}</option>{/each}</select>
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
		<button class="save" disabled={busy || qualityProfileId < 0 || !rootFolderPath} onclick={save}>{busy ? 'Saving…' : 'Save'}</button>
	</div>
</Sheet>

{#if interactive}
	<InteractiveSearchSheet mediaType="movie" {tmdbId} {title} onclose={() => (interactive = false)} ongrabbed={onchange} />
{/if}
{#if fileOpen && movie.file}
	<FileActionsSheet {title} file={movie.file} busy={fileBusy} onclose={() => (fileOpen = false)} ondelete={() => deleteFile(false)} onreplace={() => deleteFile(true)} />
{/if}

<style>
	.body { padding: 4px 16px 8px; display: flex; flex-direction: column; gap: 12px; }
	h2 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.01em; }
	.sub { margin: 0; color: var(--text-dim); font-size: 13px; }

	.statusrow { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 12px; background: var(--surface-raised); }
	.status { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
	.status.have { color: #4fd6b8; }
	.status.have .size { margin-left: auto; color: var(--text-dim); font-size: 11.5px; }
	.status.dl { color: #ffb545; }
	.status.missing { color: var(--text-dim); margin-right: auto; }
	.audio { font-size: 10px; font-weight: 700; color: var(--text-dim); background: var(--surface); border-radius: 5px; padding: 1px 5px; }
	.spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--surface); border-top-color: #ffb545; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.icon { display: grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 50%; background: var(--surface); color: var(--text-dim); }
	.icon:disabled { opacity: 0.5; }

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
	.save { min-height: 48px; border-radius: 14px; background: var(--signal); color: #fff; font-size: 16px; font-weight: 600; margin-top: 2px; }
	.save:disabled { opacity: 0.6; }
</style>
