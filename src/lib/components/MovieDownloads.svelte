<script lang="ts">
	import { notify } from '$lib/notices.svelte';
	import { haptic } from '$lib/haptics';
	import { loadArrStatus, loadArrOptions, arrOptionsFor, arrManageOn } from '$lib/arr.svelte';
	import { formatSize, audioBadges, queuePercent } from '$lib/arrClient';
	import { navigating } from '$app/state';
	import InteractiveSearchSheet from './InteractiveSearchSheet.svelte';
	import FileActionsSheet from './FileActionsSheet.svelte';
	import type { ArrMovie, ArrQueueItem } from '$lib/server/arr';

	/**
	 * Radarr management for the movie page. A film is one unit, so there's no
	 * episode list to merge into — the download status, settings, search and file
	 * actions all sit inline here. Mirrors the show page's strip + the season
	 * page's per-episode controls, collapsed onto a single title.
	 */
	type Props = { tmdbId: string; title: string };
	let { tmdbId, title }: Props = $props();

	const MIN_AVAIL = [
		{ value: 'announced', label: 'Announced' },
		{ value: 'inCinemas', label: 'In cinemas' },
		{ value: 'released', label: 'Released' }
	];

	let movie = $state<ArrMovie | null>(null);
	/* The tmdbId the loaded movie belongs to; `shown` is null until it matches the
	   current prop, so navigating film→film never flashes the previous film's
	   download state (the derived recomputes before the reset effect runs). */
	let movieId = $state<string | null>(null);
	const shown = $derived(movieId === tmdbId ? movie : null);
	let percent = $state<number | null>(null);
	let openSettings = $state(false);
	let busy = $state(false);
	let searching = $state(false);
	let interactive = $state(false);
	let fileOpen = $state(false);
	let fileBusy = $state(false);

	const opts = $derived(arrOptionsFor('movie'));
	const on = $derived(arrManageOn('movie'));

	async function refresh() {
		if (!arrManageOn('movie')) return;
		try {
			const [tRes, qRes] = await Promise.all([
				fetch(`/api/arr/title?mediaType=movie&tmdbId=${encodeURIComponent(tmdbId)}`),
				fetch('/api/arr/queue')
			]);
			if (tRes.ok) {
				movie = ((await tRes.json()) as { movie: ArrMovie | null }).movie ?? null;
				movieId = tmdbId;
			}
			if (qRes.ok && movie) {
				const q = ((await qRes.json()) as { radarr: ArrQueueItem[] }).radarr ?? [];
				const item = q.find((i) => i.movieId === movie!.id);
				percent = item ? queuePercent(item) : null;
			}
		} catch {
			/* a down Radarr just means no controls */
		}
	}

	/* Settings form, seeded from the movie once it (and the options) arrive. */
	let monitored = $state(false);
	let qualityProfileId = $state(-1);
	let rootFolderPath = $state('');
	let minimumAvailability = $state('released');
	let tags = $state<Set<string>>(new Set());
	let newTag = $state('');
	let seeded = false;
	$effect(() => {
		if (!movie || openSettings || seeded) return;
		monitored = movie.monitored;
		qualityProfileId = movie.qualityProfileId;
		rootFolderPath = movie.rootFolderPath ?? '';
		minimumAvailability = movie.minimumAvailability;
		tags = new Set(opts.tags.filter((t) => movie!.tags.includes(t.id)).map((t) => t.label));
		if (opts.tags.length || movie.tags.length === 0) seeded = true;
	});
	const tagLabels = $derived([...new Set([...opts.tags.map((t) => t.label), ...tags])]);
	const qualityName = $derived(movie ? (opts.profiles.find((p) => p.id === movie!.qualityProfileId)?.name ?? null) : null);

	/* Re-fetch when the movie changes — the movie page component is reused across
	   movie→movie navigation, so an onMount-only load would show the previous
	   film's download state. Reset first so nothing stale lingers. */
	$effect(() => {
		const id = tmdbId;
		let cancelled = false;
		movie = null;
		percent = null;
		seeded = false;
		(async () => {
			await loadArrStatus();
			if (cancelled || !arrManageOn('movie')) return;
			void loadArrOptions();
			void id;
			await refresh();
		})();
		return () => {
			cancelled = true;
		};
	});

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
			seeded = false;
			openSettings = false;
			await refresh();
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
			setTimeout(refresh, 1500);
		} catch (err) {
			void notify(`Couldn't search — ${err instanceof Error ? err.message : err}`);
		} finally {
			searching = false;
		}
	}

	async function deleteFile(thenReplace = false) {
		if (!movie?.file || fileBusy) return;
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
			await refresh();
			if (thenReplace) interactive = true;
		} catch (err) {
			void notify(`Couldn't delete the file — ${err instanceof Error ? err.message : err}`);
		} finally {
			fileBusy = false;
		}
	}
</script>

{#if on && shown && !navigating.to}
	<div class="wrap">
		<div class="statusrow">
			{#if shown.hasFile && shown.file}
				<button class="status have" onclick={() => (fileOpen = true)}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
					<span>{shown.file.quality ?? 'Downloaded'}</span>
					{#each audioBadges(shown.file) as a (a)}<span class="audio">{a}</span>{/each}
					<span class="size tnum">{formatSize(shown.file.size)}</span>
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

		<button class="bar" aria-expanded={openSettings} onclick={() => (openSettings = !openSettings)}>
			<svg class="srv" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01" /></svg>
			<span class="label">Radarr settings</span>
			<span class="summary">{shown.monitored ? 'monitored' : 'unmonitored'}{qualityName ? ` · ${qualityName}` : ''}</span>
			<svg class="chev" class:open={openSettings} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
		</button>

		{#if openSettings}
			<div class="panel">
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
		{/if}
	</div>
{/if}

{#if interactive && shown}
	<InteractiveSearchSheet mediaType="movie" {tmdbId} {title} onclose={() => (interactive = false)} ongrabbed={refresh} />
{/if}
{#if fileOpen && shown?.file}
	<FileActionsSheet {title} file={shown.file} busy={fileBusy} onclose={() => (fileOpen = false)} ondelete={() => deleteFile(false)} onreplace={() => deleteFile(true)} />
{/if}

<style>
	.wrap { margin: -6px var(--gutter) 16px; border-radius: var(--radius); background: var(--surface); overflow: hidden; }
	.statusrow { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
	.status { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
	.status.have { color: #4fd6b8; }
	.status.have .size { margin-left: auto; color: var(--text-dim); font-size: 11.5px; }
	.status.dl { color: #ffb545; }
	.status.missing { color: var(--text-dim); margin-right: auto; }
	.audio { font-size: 10px; font-weight: 700; color: var(--text-dim); background: var(--surface-raised); border-radius: 5px; padding: 1px 5px; }
	.spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--surface-raised); border-top-color: #ffb545; animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.icon { display: grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 50%; background: var(--surface-raised); color: var(--text-dim); }
	.icon:disabled { opacity: 0.5; }

	.bar { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 44px; padding: 0 12px; border-top: 1px solid var(--surface-raised); text-align: left; }
	.srv { color: var(--text-dim); flex: none; }
	.label { font-size: 13px; color: var(--text); }
	.summary { margin-left: auto; font-size: 11.5px; color: var(--signal-solid); }
	.chev { color: var(--text-dim); flex: none; transition: transform 160ms ease; }
	.chev.open { transform: rotate(180deg); }

	.panel { display: flex; flex-direction: column; gap: 12px; padding: 4px 12px 14px; }
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
	.save { min-height: 40px; border-radius: 10px; background: var(--signal); color: #fff; font-size: 14px; font-weight: 600; }
	.save:disabled { opacity: 0.6; }
</style>
