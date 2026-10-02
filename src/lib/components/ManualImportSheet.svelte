<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { notify } from '$lib/notices.svelte';
	import { haptic } from '$lib/haptics';
	import type { ArrImportCandidate } from '$lib/server/arr';
	import { onMount } from 'svelte';

	/**
	 * Resolve an import-blocked download. Sonarr/Radarr often grab a release but
	 * refuse to auto-import it (e.g. "matched to series by ID"); the files are fine,
	 * they just need a manual nudge. This fetches the candidate files with the
	 * service's own suggested mapping, shows what will be imported (and why it
	 * stalled), and imports the mappable ones.
	 */
	type Props = {
		mediaType: string;
		downloadId: string;
		title: string;
		onclose: () => void;
		onimported: () => void;
	};
	let { mediaType, downloadId, title, onclose, onimported }: Props = $props();

	let loading = $state(true);
	let error = $state<string | null>(null);
	let candidates = $state<ArrImportCandidate[]>([]);
	let importing = $state(false);

	const mappable = $derived(candidates.filter((c) => c.mappable));

	onMount(async () => {
		try {
			const res = await fetch(`/api/arr/import?mediaType=${encodeURIComponent(mediaType)}&downloadId=${encodeURIComponent(downloadId)}`);
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			candidates = body.candidates ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	});

	async function doImport() {
		if (importing || !mappable.length) return;
		importing = true;
		try {
			const res = await fetch('/api/arr/import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType, downloadId, fileIds: mappable.map((c) => c.id) })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			haptic();
			void notify(`Importing ${mappable.length} file${mappable.length === 1 ? '' : 's'}`);
			onimported();
			onclose();
		} catch (err) {
			void notify(`Couldn't import — ${err instanceof Error ? err.message : err}`);
		} finally {
			importing = false;
		}
	}
</script>

<Sheet label={`Resolve import · ${title}`} scrollable {onclose}>
	<div class="head">
		<h2>Resolve import</h2>
		<p class="sub">{title}</p>
	</div>

	{#if loading}
		<div class="state"><span class="spin" aria-hidden="true"></span><span>Reading the download…</span></div>
	{:else if error}
		<div class="state err">Couldn't read it — {error}</div>
	{:else if !candidates.length}
		<div class="state">No files to import.</div>
	{:else}
		<ul class="files">
			{#each candidates as c (c.id)}
				<li class:blocked={!c.mappable}>
					<div class="top">
						{#if c.mappable}
							<svg class="ok" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
						{:else}
							<svg class="bad" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v4m0 3.5v.1" /></svg>
						{/if}
						<span class="ftitle">{c.title || c.name}</span>
					</div>
					<div class="meta tnum">
						{#if c.quality}<span class="q">{c.quality}</span>{/if}
						{#each c.languages as l (l)}<span>{l}</span>{/each}
					</div>
					{#if c.rejections.length}
						<ul class="rej">{#each c.rejections as why (why)}<li>{why}</li>{/each}</ul>
					{/if}
				</li>
			{/each}
		</ul>

		<button class="import" disabled={importing || !mappable.length} onclick={doImport}>
			{#if importing}Importing…{:else if mappable.length}Import {mappable.length} file{mappable.length === 1 ? '' : 's'}{:else}Nothing can be imported{/if}
		</button>
	{/if}
</Sheet>

<style>
	.head { padding: 2px 16px 10px; }
	h2 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.01em; }
	.sub { margin: 2px 0 0; font-size: 13px; color: var(--text-dim); word-break: break-word; }

	.state { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 34px 16px; color: var(--text-dim); font-size: 14px; }
	.state.err { color: var(--text); }
	.spin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--surface-raised); border-top-color: var(--signal-solid); animation: spin 0.8s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }

	.files { list-style: none; margin: 0; padding: 0 12px; display: flex; flex-direction: column; gap: 8px; }
	.files li { border-radius: 12px; background: var(--surface-raised); padding: 11px 12px; }
	.files li.blocked { opacity: 0.8; }
	.top { display: flex; align-items: flex-start; gap: 8px; }
	.ok { color: #4fd6b8; flex: none; margin-top: 1px; }
	.bad { color: #e2a34b; flex: none; margin-top: 1px; }
	.ftitle { font-size: 13.5px; line-height: 1.35; word-break: break-word; }
	.meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 11.5px; color: var(--text-dim); padding-left: 25px; margin-top: 4px; }
	.meta .q { color: var(--text); font-weight: 600; }
	.rej { list-style: none; margin: 6px 0 0; padding-left: 25px; display: flex; flex-direction: column; gap: 3px; }
	.rej li { font-size: 11.5px; color: #e2a34b; }

	.import { width: calc(100% - 24px); margin: 14px 12px 4px; min-height: 48px; border-radius: 14px; background: var(--signal); color: #fff; font-size: 16px; font-weight: 600; }
	.import:disabled { opacity: 0.6; }
</style>
