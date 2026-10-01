<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { notify } from '$lib/notices.svelte';
	import { haptic } from '$lib/haptics';
	import { formatSize, isUsenet } from '$lib/arrClient';
	import type { ArrRelease } from '$lib/server/arr';
	import { onMount } from 'svelte';

	/**
	 * Interactive (manual) release search for an episode, a season, or a movie.
	 * Fires the release query on mount — it hits indexers and can take 5–30s, so a
	 * spinner carries it — lists what came back sorted for scanning, and grabs the
	 * one you pick. Rejected releases stay visible, dimmed, with an Override, which
	 * is the whole point of going manual.
	 *
	 * Usenet-shaped by default (age · grabs, no seeders); a torrent release still
	 * shows its seeders. The parent decides what we're searching for via the
	 * optional episodeId / season.
	 */
	type Props = {
		mediaType: string;
		tmdbId: string;
		title: string;
		/** Sonarr: a single episode. */
		episodeId?: number;
		/** Sonarr: a whole season (when no episodeId). */
		season?: number;
		onclose: () => void;
		/** Called after a successful grab, so the page can refresh its state. */
		ongrabbed?: () => void;
	};
	let { mediaType, tmdbId, title, episodeId, season, onclose, ongrabbed }: Props = $props();

	let loading = $state(true);
	let error = $state<string | null>(null);
	let releases = $state<ArrRelease[]>([]);
	let expanded = $state<string | null>(null);
	let grabbing = $state<string | null>(null);

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

	{#if loading}
		<div class="state">
			<span class="spin" aria-hidden="true"></span>
			<span>Asking your indexers…</span>
		</div>
	{:else if error}
		<div class="state err">Couldn't search — {error}</div>
	{:else if !releases.length}
		<div class="state">No releases found.</div>
	{:else}
		<ul class="rels">
			{#each releases as r (r.guid)}
				{@const open = expanded === r.guid}
				<li class:rejected={r.rejected}>
					<button class="rel" aria-expanded={open} onclick={() => (expanded = open ? null : r.guid)}>
						<span class="rtitle">{r.title}</span>
						<span class="meta tnum">
							{#if r.quality}<span class="q">{r.quality}</span>{/if}
							<span>{formatSize(r.size)}</span>
							<span>{r.age}d</span>
							{#if isUsenet(r)}
								{#if r.grabs != null}<span>{r.grabs} grabs</span>{/if}
							{:else if r.seeders != null}
								<span class="seed">▲ {r.seeders}</span>
							{/if}
							<span class="ix">{r.indexer}</span>
						</span>
						{#if r.rejected}
							<span class="flag">Rejected · tap for why</span>
						{/if}
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
								{#if r.flags.length}
									<span class="k">Flags</span><span class="v">{r.flags.join(', ')}</span>
								{/if}
							</div>
							{#if r.rejections.length}
								<ul class="rej">
									{#each r.rejections as why (why)}<li>{why}</li>{/each}
								</ul>
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

	.state {
		display: flex; align-items: center; justify-content: center; gap: 10px;
		padding: 34px 16px; color: var(--text-dim); font-size: 14px;
	}
	.state.err { color: var(--text); }
	.spin {
		width: 18px; height: 18px; border-radius: 50%;
		border: 2px solid var(--surface-raised); border-top-color: var(--signal-solid);
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }

	.rels { list-style: none; margin: 0; padding: 0 12px; display: flex; flex-direction: column; gap: 8px; }
	.rels li { border-radius: 12px; background: var(--surface-raised); overflow: hidden; }
	.rels li.rejected { opacity: 0.72; }

	.rel {
		display: flex; flex-direction: column; gap: 6px;
		width: 100%; padding: 11px 12px; text-align: left;
	}
	.rtitle { font-size: 13px; line-height: 1.35; word-break: break-word; }
	.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11.5px; color: var(--text-dim); }
	.meta .q { color: var(--text); font-weight: 600; }
	.meta .seed { color: #4fd6b8; }
	.meta .ix { margin-left: auto; }
	.flag { font-size: 11px; color: #e24b4a; }

	.detail { padding: 0 12px 12px; }
	.grid { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; font-size: 12.5px; padding: 6px 0 2px; }
	.k { color: var(--text-dim); }
	.v { color: var(--text); }
	.v.pos { color: #4fd6b8; }
	.badges { display: flex; flex-wrap: wrap; gap: 5px; }
	.badge { background: var(--surface); border-radius: 6px; padding: 1px 7px; font-size: 11.5px; }
	.rej { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
	.rej li { font-size: 11.5px; color: #e2a34b; }

	.grab {
		width: 100%; min-height: 40px; margin-top: 10px;
		border-radius: 10px; background: var(--signal); color: #fff;
		font-size: 14px; font-weight: 600;
	}
	.grab.override { background: var(--surface); color: var(--text); border: 1px solid var(--text-dim); }
	.grab:disabled { opacity: 0.6; }
</style>
