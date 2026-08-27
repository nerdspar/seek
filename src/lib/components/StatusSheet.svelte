<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { STATUS_CHOICES } from '$lib/tracking';

	/** Where you are with a show. Films do not use this — watched is their whole
	 *  status, so their middle chip toggles rather than opening anything. */
	type Props = {
		title: string;
		status: number | null;
		busy?: boolean;
		onpick: (status: number) => void;
		onclose: () => void;
	};
	let { title, status, busy = false, onpick, onclose }: Props = $props();
</script>

<Sheet label={title} {onclose}>
	<div class="pad">
		<h2>Status</h2>
		<div class="rows">
			{#each STATUS_CHOICES as choice (choice.value)}
				<button
					class:on={status === choice.value}
					disabled={busy}
					onclick={() => onpick(choice.value)}
				>
					<span>{choice.label}</span>
					{#if status === choice.value}
						<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
					{/if}
				</button>
			{/each}
		</div>
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter) 8px; }
	h2 { margin: 0 0 14px; font-size: 18px; font-weight: 600; }
	.rows { display: flex; flex-direction: column; gap: 4px; }
	.rows button {
		display: flex; align-items: center; justify-content: space-between; gap: 12px;
		min-height: var(--tap); padding: 0 14px;
		border-radius: var(--radius); background: var(--surface-raised);
		font-size: 15px; color: var(--text); text-align: left;
	}
	.rows button.on { background: var(--signal); color: #fff; }
	button:disabled { opacity: 0.5; }
</style>
