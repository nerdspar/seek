<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { formatSize, audioBadges } from '$lib/arrClient';
	import type { ArrFile } from '$lib/server/arr';

	/**
	 * What to do with a file you already have: see what it actually is (quality,
	 * size, the real audio/subtitle tracks from mediainfo — the trustworthy dub
	 * check), then Delete it, or Replace it (delete, then the parent opens the
	 * interactive search so you pick the swap rather than a silent re-grab).
	 */
	type Props = {
		title: string;
		file: ArrFile;
		busy?: boolean;
		onclose: () => void;
		ondelete: () => void;
		onreplace: () => void;
	};
	let { title, file, busy = false, onclose, ondelete, onreplace }: Props = $props();

	const audio = $derived(audioBadges(file));
	const subs = $derived(file.mediaInfo?.subtitles ?? []);
</script>

<Sheet label={`File · ${title}`} {onclose}>
	<div class="body">
		<h2>{title}</h2>
		<p class="sub">Downloaded file</p>

		<div class="grid">
			{#if file.quality}<span class="k">Quality</span><span class="v">{file.quality}</span>{/if}
			<span class="k">Size</span><span class="v">{formatSize(file.size)}</span>
			{#if audio.length}
				<span class="k">Audio</span>
				<span class="v badges">{#each audio as a (a)}<span class="badge have">{a}</span>{/each}</span>
			{/if}
			{#if subs.length}
				<span class="k">Subtitles</span>
				<span class="v">{subs.map((s) => s.toUpperCase()).join(', ')}</span>
			{/if}
			{#if file.mediaInfo?.videoDynamicRange}
				<span class="k">Video</span>
				<span class="v">{[file.mediaInfo.resolution, file.mediaInfo.videoDynamicRange].filter(Boolean).join(' · ')}</span>
			{/if}
		</div>
		{#if file.mediaInfo}
			<p class="note">Real tracks from the file's mediainfo.</p>
		{/if}

		<button class="action replace" disabled={busy} onclick={onreplace}>
			<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>
			Replace…
		</button>
		<button class="action delete" disabled={busy} onclick={ondelete}>
			<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7" /></svg>
			{busy ? 'Deleting…' : 'Delete file'}
		</button>
	</div>
</Sheet>

<style>
	.body { padding: 4px 16px 8px; display: flex; flex-direction: column; gap: 10px; }
	h2 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.01em; }
	.sub { margin: 0; color: var(--text-dim); font-size: 13px; }
	.grid { display: grid; grid-template-columns: auto 1fr; gap: 7px 14px; font-size: 13.5px; margin-top: 2px; }
	.k { color: var(--text-dim); }
	.v { color: var(--text); }
	.badges { display: flex; flex-wrap: wrap; gap: 5px; }
	.badge.have { background: #4fd6b8; color: #04342c; border-radius: 6px; padding: 1px 8px; font-size: 12px; font-weight: 600; }
	.note { margin: 2px 0 4px; font-size: 11.5px; color: var(--text-dim); }

	.action {
		display: flex; align-items: center; justify-content: center; gap: 9px;
		min-height: var(--tap); border-radius: 12px;
		font-size: 15px; font-weight: 600;
	}
	.action.replace { background: var(--surface-raised); color: var(--text); }
	.action.delete { background: color-mix(in srgb, #e24b4a 16%, var(--surface-raised)); color: #ff7a78; }
	.action:disabled { opacity: 0.6; }
</style>
