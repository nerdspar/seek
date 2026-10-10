<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { notify } from '$lib/notices.svelte';
	import { haptic } from '$lib/haptics';
	import { togetherPick, closeTogetherPicker, type TogetherShow } from '$lib/togetherPick.svelte';

	let { show }: { show: TogetherShow } = $props();
	let busy = $state(false);
	let chosen = $state<boolean | null>(null);
	const shared = $derived(chosen ?? show.shared);

	async function choose(together: boolean) {
		if (busy || together === shared) {
			closeTogetherPicker();
			return;
		}
		busy = true;
		try {
			const res = await fetch('/api/tags', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: 'tv', source: show.source, mediaId: show.mediaId, title: show.title, joint: together })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			chosen = together;
			togetherPick.show = null;
			haptic();
			void notify(`Watching ${show.title} ${together ? 'together' : 'alone'}`);
		} catch (err) {
			void notify(`Couldn't update ${show.title} — ${err instanceof Error ? err.message : err}`);
			busy = false;
		}
	}
</script>

<Sheet label="Watching with" onclose={closeTogetherPicker}>
	<div class="pad">
		<h2>{show.title}</h2>
		<div class="rows">
			<button class:on={shared} disabled={busy} onclick={() => choose(true)}>
				<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 19v-1a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v1" /><circle cx="9" cy="8" r="3" /><path d="M21 19v-1a3 3 0 0 0-2.2-2.9M15 5.1A3 3 0 0 1 15 11" /></svg>
				<span>Together</span>
				{#if shared}<span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg></span>{/if}
			</button>
			<button class:on={!shared} disabled={busy} onclick={() => choose(false)}>
				<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1" /><circle cx="10" cy="8" r="3.2" /></svg>
				<span>Alone</span>
				{#if !shared}<span class="tick" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg></span>{/if}
			</button>
		</div>
		<p class="hint">Together, a play by either of you counts for both.</p>
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter) 10px; }
	h2 { margin: 0 0 14px; font-size: 18px; font-weight: 600; }
	.rows { display: flex; flex-direction: column; gap: 4px; }
	.rows button {
		display: flex; align-items: center; gap: 12px;
		min-height: var(--tap); padding: 0 14px;
		border-radius: var(--radius); background: var(--surface-raised);
		font-size: 15px; color: var(--text); text-align: left;
	}
	.rows button.on { box-shadow: inset 0 0 0 1.5px var(--signal-solid); }
	.tick { margin-left: auto; color: var(--signal-solid); display: grid; place-items: center; }
	button:disabled { opacity: 0.5; }
	.hint { margin: 12px 2px 0; font-size: 12.5px; color: var(--text-dim); }
</style>
