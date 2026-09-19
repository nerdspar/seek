<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { notify } from '$lib/notices.svelte';
	import { markInArr, arrServiceName } from '$lib/arr.svelte';
	import { haptic } from '$lib/haptics';

	/**
	 * The per-add choice: monitor only, or add and start searching now. Owned by
	 * the page (one instance) and handed whichever title was tapped, so the sheet
	 * never nests inside a browse tile's own button.
	 */
	type Item = { mediaType: string; tmdbId: string; title: string };
	type Props = { item: Item; onclose: () => void };
	let { item, onclose }: Props = $props();

	const service = $derived(arrServiceName(item.mediaType));
	let busy = $state(false);

	async function add(search: boolean) {
		if (busy) return;
		busy = true;
		try {
			const res = await fetch('/api/arr/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: item.mediaType, tmdbId: item.tmdbId, search })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);

			markInArr(item.mediaType, item.tmdbId);
			haptic();
			void notify(
				body.alreadyAdded
					? `${item.title} is already in ${service}`
					: search
						? `Added ${item.title} to ${service} and started searching`
						: `Added ${item.title} to ${service}`
			);
			onclose();
		} catch (err) {
			void notify(`Couldn't add ${item.title} — ${err instanceof Error ? err.message : err}`);
		} finally {
			busy = false;
		}
	}
</script>

<Sheet label={`Add ${item.title} to ${service}`} {onclose}>
	<div class="body">
		<h2>{item.title}</h2>
		<p class="sub">Send to {service} for monitoring.</p>

		<button class="action primary" disabled={busy} onclick={() => add(true)}>
			<span class="lead">Add &amp; search now</span>
			<span class="note">Start grabbing straight away</span>
		</button>
		<button class="action" disabled={busy} onclick={() => add(false)}>
			<span class="lead">Monitor only</span>
			<span class="note">Add it, don’t search yet</span>
		</button>
	</div>
</Sheet>

<style>
	.body {
		padding: 4px 16px 8px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	h2 {
		margin: 0;
		font-size: 19px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.sub {
		margin: 0 0 6px;
		color: var(--text-dim);
		font-size: 14px;
	}
	.action {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		width: 100%;
		padding: 12px 16px;
		border-radius: 14px;
		background: var(--surface-raised);
		color: var(--text);
		text-align: left;
	}
	.action.primary {
		background: var(--signal);
		color: #fff;
	}
	.action:disabled {
		opacity: 0.6;
	}
	.lead {
		font-size: 16px;
		font-weight: 600;
	}
	.note {
		font-size: 13px;
		opacity: 0.85;
	}
</style>
