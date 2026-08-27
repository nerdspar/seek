<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { notify } from '$lib/notices.svelte';

	/**
	 * The rare things. Status, rating and company are one tap each on the chip
	 * row; what is left is sharing, jumping to Floppy, and the one irreversible
	 * action on the page — which is exactly what an overflow menu is for.
	 */
	type Props = {
		title: string;
		/** Public TMDB page. The only link worth sending someone outside the house. */
		sourceUrl: string | null;
		/** Floppy's own page for this item, when FLOPPY_PUBLIC_URL is configured. */
		floppyUrl: string | null;
		busy?: boolean;
		onremove: () => void;
		onclose: () => void;
	};
	let { title, sourceUrl, floppyUrl, busy = false, onremove, onclose }: Props = $props();

	async function share() {
		if (!sourceUrl) return;
		/* The share sheet is the point on a phone, but it does not exist
		   everywhere — and it rejects when the user simply dismisses it, which is
		   not a failure worth reporting. Copying is the honest fallback. */
		try {
			if (navigator.share) {
				await navigator.share({ title, url: sourceUrl });
				onclose();
				return;
			}
			await navigator.clipboard.writeText(sourceUrl);
			void notify('Link copied');
			onclose();
		} catch (err) {
			if ((err as Error)?.name === 'AbortError') return;
			try {
				await navigator.clipboard.writeText(sourceUrl);
				void notify('Link copied');
				onclose();
			} catch {
				/* Nothing left to try: no share sheet and no clipboard. Saying so
				   beats a button that silently does nothing. */
				void notify('Sharing is not available here');
			}
		}
	}
</script>

<Sheet label={title} {onclose}>
	<div class="pad">
		<h2>{title}</h2>
		<div class="rows">
			{#if sourceUrl}
				<button disabled={busy} onclick={share}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M8.5 7.5 12 4l3.5 3.5" /><path d="M6 12.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-6.5" /></svg>
					<span>Share</span>
				</button>
			{/if}
			{#if floppyUrl}
				<a class="row" href={floppyUrl} target="_blank" rel="noreferrer" onclick={onclose}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6" /><path d="M20 4 10.5 13.5" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
					<span>Open in Floppy</span>
				</a>
			{/if}
			<button class="danger" disabled={busy} onclick={onremove}>
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7" /><path d="M6.5 7l.8 11a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9L18.5 7" /></svg>
				<span>Remove from library</span>
			</button>
		</div>
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter) 8px; }
	h2 { margin: 0 0 14px; font-size: 18px; font-weight: 600; }
	.rows { display: flex; flex-direction: column; gap: 4px; }
	.rows button, .rows .row {
		display: flex; align-items: center; gap: 12px;
		min-height: var(--tap); padding: 0 14px;
		border-radius: var(--radius); background: var(--surface-raised);
		font-size: 15px; color: var(--text); text-align: left; text-decoration: none;
	}
	.rows .danger { color: #ff8a8a; }
	button:disabled { opacity: 0.5; }
</style>
