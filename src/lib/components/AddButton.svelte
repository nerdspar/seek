<script lang="ts">
	import { notify } from '$lib/notices.svelte';
	import { trackedOf, setTitle, confirmTitle, revertTitle } from '$lib/status.svelte';
	/** Inline add/remove for a Discover or search result (§6.4). Owns its own
	 *  request so any grid can drop it in without threading state. */
	type Props = {
		mediaType: 'tv' | 'movie';
		source: string;
		mediaId: string;
		title: string;
		added?: boolean;
		onerror?: (message: string) => void;
		size?: number;
	};
	let { mediaType, source, mediaId, title, added = false, onerror, size = 32 }: Props = $props();

	/* Membership comes from the shared overlay (status.svelte.ts) laid over the
	   value the page supplied, so an add/remove done anywhere — here, another grid,
	   or a detail page — flips this glyph live, and a title nobody has touched falls
	   through to `added`. */
	const on = $derived(trackedOf(source, mediaId, added));
	let busy = $state(false);

	async function toggle(e: MouseEvent) {
		e.stopPropagation();
		if (busy) return;
		const was = on;
		const next = !was;
		busy = true;
		setTitle(source, mediaId, { tracked: next });
		try {
			const res = await fetch('/api/library', {
				method: next ? 'POST' : 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType, source, mediaId })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			confirmTitle(source, mediaId, { tracked: next });
			/* The glyph flips, which is easy to miss on a poster the size of a
			   thumbnail — and on iOS there is no haptic to feel instead. */
			void notify(next ? `Added ${title}` : `Removed ${title}`);
		} catch (err) {
			revertTitle(source, mediaId, ['tracked']);
			onerror?.(`Couldn't ${next ? 'add' : 'remove'} ${title} — ${err instanceof Error ? err.message : err}`);
		} finally {
			busy = false;
		}
	}
</script>

<button
	class:on
	disabled={busy}
	style:width={`${size}px`}
	style:height={`${size}px`}
	aria-label={on ? `Remove ${title}` : `Add ${title}`}
	onclick={toggle}
>
	{#if on}
		<svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
	{:else}
		<svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56} fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
	{/if}
</button>

<style>
	button {
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	button.on {
		background: var(--signal);
		color: #fff;
	}
	button:disabled {
		opacity: 0.6;
	}
</style>
