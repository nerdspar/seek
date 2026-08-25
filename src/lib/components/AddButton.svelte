<script lang="ts">
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

	/** Local optimistic state, re-synced whenever the owner supplies a new value. */
	let on = $state(false);
	let busy = $state(false);
	$effect(() => {
		on = added;
	});

	async function toggle(e: MouseEvent) {
		e.stopPropagation();
		if (busy) return;
		const was = on;
		busy = true;
		on = !was;
		try {
			const res = await fetch('/api/library', {
				method: was ? 'DELETE' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType, source, mediaId })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
		} catch (err) {
			on = was;
			onerror?.(`Couldn't ${was ? 'remove' : 'add'} ${title} — ${err instanceof Error ? err.message : err}`);
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
		box-shadow: 0 2px 8px rgb(0 0 0 / 0.4);
	}
	button.on {
		background: var(--signal);
		color: #fff;
	}
	button:disabled {
		opacity: 0.6;
	}
</style>
