<script lang="ts">
	import DownloadSheet from './DownloadSheet.svelte';
	import { requestActive, requestLabel, type BookCard, type BookRequest, type RequestMediaKind } from '$lib/books';

	/** Getting a book you don't own: Download ebook / Download audiobook (through
	 *  BookOrbit and your download sources), and where a download already is. */
	type Props = {
		hardcoverId: number;
		book: Pick<BookCard, 'title' | 'author' | 'coverUrl' | 'year'>;
		initial: BookRequest | null;
		canRequest: boolean;
		onchange?: () => void;
	};
	let { hardcoverId, book, initial, canRequest, onchange }: Props = $props();

	let kind = $state<RequestMediaKind | null>(null);
	const active = $derived(initial && requestActive(initial.status) ? initial : null);
	const pct = (p: number) => `${Math.round(p * 100)}%`;
</script>

{#if canRequest}
	{#if active}
		<button class="status" onclick={() => (kind = active.mediaKind === 'audiobook' ? 'audiobook' : 'ebook')}>
			<span class="label">{requestLabel(active.status)}</span>
			<span class="hint">{active.mediaKind === 'audiobook' ? 'Audiobook' : 'Ebook'}{active.progress !== null ? ` · ${pct(active.progress)}` : ''} · View</span>
		</button>
	{:else}
		{#if initial && (initial.status === 'failed' || initial.status === 'rejected')}
			<p class="note">Last try: {requestLabel(initial.status).toLowerCase()}{initial.reason ? ` — ${initial.reason}` : ''}.</p>
		{/if}
		<div class="get">
			<button onclick={() => (kind = 'ebook')}>
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
				Download ebook
			</button>
			<button onclick={() => (kind = 'audiobook')}>
				<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
				Download audiobook
			</button>
		</div>
	{/if}
{/if}

{#if kind}
	<DownloadSheet
		book={{ hardcoverId, ...book }}
		{kind}
		existing={active && (active.mediaKind === 'audiobook' ? 'audiobook' : 'ebook') === kind ? active : null}
		onclose={() => (kind = null)}
		{onchange}
	/>
{/if}

<style>
	.get { display: flex; gap: 6px; margin-top: 12px; }
	.get button {
		flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
		min-height: 40px; padding: 0 10px; border-radius: 10px;
		background: var(--surface-raised); font-size: 13.5px; font-weight: 600; color: var(--text);
	}
	.status {
		display: flex; flex-direction: column; gap: 2px; width: 100%; margin-top: 12px;
		padding: 10px 12px; border-radius: var(--radius); background: var(--surface-raised); text-align: left;
	}
	.label { font-size: 13.5px; font-weight: 650; }
	.hint { font-size: 12px; color: var(--text-dim); }
	.note { margin: 12px 0 0; font-size: 13px; color: var(--text-dim); }
</style>
