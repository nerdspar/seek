<script lang="ts">
	import Sheet from './Sheet.svelte';
	import type { BookReadStatus } from '$lib/books';

	/** Where you are with a book — the same picker as a show's status. A book in
	 *  your library can go back to "Not started"; one of your own books can be
	 *  removed from your list instead. */
	type Props = {
		title: string;
		status: BookReadStatus | null;
		owned: boolean;
		busy?: boolean;
		onpick: (status: BookReadStatus | 'remove') => void;
		onclose: () => void;
	};
	let { title, status, owned, busy = false, onpick, onclose }: Props = $props();

	const CHOICES: { value: BookReadStatus; label: string }[] = [
		{ value: 'want_to_read', label: 'Want to read' },
		{ value: 'reading', label: 'Reading' },
		{ value: 'read', label: 'Read' },
		{ value: 'on_hold', label: 'Paused' },
		{ value: 'abandoned', label: 'Did not finish' }
	];
	// Rereading and skimmed (set on a reader) read as their nearest choice.
	const current = $derived(status === 'rereading' ? 'reading' : status === 'skimmed' ? 'read' : status);
</script>

<Sheet label={title} {onclose}>
	<div class="pad">
		<h2>Status</h2>
		<div class="rows">
			{#each CHOICES as choice (choice.value)}
				<button class:on={current === choice.value} disabled={busy} onclick={() => onpick(choice.value)}>
					<span>{choice.label}</span>
					{#if current === choice.value}
						<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
					{/if}
				</button>
			{/each}
			{#if owned}
				<button class:on={current === 'unread'} disabled={busy} onclick={() => onpick('unread')}>
					<span>Not started</span>
					{#if current === 'unread'}
						<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
					{/if}
				</button>
			{:else if status}
				<button class="remove" disabled={busy} onclick={() => onpick('remove')}>Remove from my books</button>
			{/if}
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
	.rows .remove { margin-top: 8px; justify-content: center; color: #ff8a8a; }
	button:disabled { opacity: 0.5; }
</style>
