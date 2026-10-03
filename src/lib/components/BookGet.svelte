<script lang="ts">
	import { requestLabel, requestActive, requestCancellable, type BookCard, type BookRequest, type RequestMediaKind } from '$lib/books';

	/** Getting a book you don't own: asking BookOrbit for the ebook or the
	 *  audiobook (its approval and Prowlarr do the rest), and where that is. */
	type Props = {
		hardcoverId: number;
		book: Pick<BookCard, 'title' | 'author' | 'coverUrl' | 'year'>;
		initial: BookRequest | null;
		canRequest: boolean;
		onchange?: () => void;
	};
	let { hardcoverId, book, initial, canRequest, onchange }: Props = $props();

	let saving = $state(false);
	let saveError = $state<string | null>(null);
	const pct = (p: number) => `${Math.round(p * 100)}%`;

	/* ── Requests: ask BookOrbit to get it (its approval + Prowlarr do the rest) ── */
	let reqPicked = $state<BookRequest | null | undefined>(undefined);
	const request = $derived(reqPicked !== undefined ? reqPicked : initial);
	let reqNote = $state<string | null>(null);

	/** The server's own words when it refuses (BookOrbit explains itself). */
	const failure = async (res: Response) =>
		((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `HTTP ${res.status}`;

	async function ask(mediaKind: RequestMediaKind) {
		if (saving) return;
		saving = true;
		saveError = null;
		reqNote = null;
		try {
			const res = await fetch('/api/books/requests', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					hardcoverId,
					title: book.title,
					author: book.author,
					coverUrl: book.coverUrl,
					year: book.year,
					mediaKind
				})
			});
			if (!res.ok) throw new Error(await failure(res));
			const out = (await res.json()) as { request: BookRequest; joined: boolean };
			reqPicked = out.request;
			if (out.joined) reqNote = 'Someone already asked for this one — you’re on that request too.';
			onchange?.();
		} catch (e) {
			saveError = `Couldn't request — ${(e as Error).message}`;
		} finally {
			saving = false;
		}
	}

	async function cancelAsk() {
		if (!request || saving) return;
		saving = true;
		saveError = null;
		try {
			const res = await fetch(`/api/books/requests/${request.id}/cancel`, { method: 'POST' });
			if (!res.ok) throw new Error(await failure(res));
			reqPicked = null;
			reqNote = null;
			onchange?.();
		} catch (e) {
			saveError = `Couldn't cancel — ${(e as Error).message}`;
		} finally {
			saving = false;
		}
	}
</script>

{#if request && requestActive(request.status)}
	<div class="req">
		<span class="reqtext">
			<span class="reqlabel">{requestLabel(request.status)}</span>
			<span class="reqsub">Requested {request.mediaKind}{request.progress !== null ? ` · ${pct(request.progress)}` : ''}</span>
		</span>
		{#if requestCancellable(request.status)}
			<button class="reqcancel" disabled={saving} onclick={cancelAsk}>Cancel</button>
		{/if}
	</div>
	{#if request.progress !== null}
		<span class="track reqtrack"><span class="fill" style:width={pct(request.progress)}></span></span>
	{/if}
{:else if canRequest}
	{#if request}
		<p class="notowned">
			Last request: {requestLabel(request.status).toLowerCase()}{request.reason ? ` — ${request.reason}` : ''}.
		</p>
	{:else}
		<p class="notowned">Not in your library yet.</p>
	{/if}
	<div class="picker2 get">
		<button disabled={saving} onclick={() => ask('ebook')}>{request ? 'Ask again — ebook' : 'Get the ebook'}</button>
		<button disabled={saving} onclick={() => ask('audiobook')}>Audiobook</button>
	</div>
{:else}
	<p class="notowned">Not in your library yet.</p>
{/if}
{#if reqNote}<p class="notowned">{reqNote}</p>{/if}
{#if saveError}<p class="err">{saveError}</p>{/if}

<style>
	.notowned { margin: 14px 0 0; font-size: 13px; color: var(--text-dim); }
	.err { margin: 8px 0 0; font-size: 13px; color: #ff8a8a; }
	.picker2 { display: flex; gap: 6px; margin-top: 8px; }
	.picker2 button {
		min-height: 36px; padding: 0 12px; border-radius: 9px;
		background: var(--surface-raised); font-size: 13px; font-weight: 600;
	}
	.picker2 button:disabled { opacity: 0.7; }
	.get { justify-content: center; }
	.get button { flex: 1; color: var(--text); }
	.req {
		display: flex; align-items: center; gap: 10px;
		margin-top: 10px; padding: 10px 12px;
		border-radius: var(--radius); background: var(--surface-raised);
	}
	.reqtext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
	.reqlabel { font-size: 13.5px; font-weight: 650; }
	.reqsub { font-size: 12px; color: var(--text-dim); }
	.reqcancel { flex: none; min-height: 32px; padding: 0 12px; border-radius: 9px; background: var(--surface); font-size: 12.5px; font-weight: 600; color: var(--text-dim); }
	.track { height: 5px; border-radius: 3px; background: var(--surface); overflow: hidden; }
	.fill { display: block; height: 100%; border-radius: 3px; background: var(--signal); }
	.reqtrack { display: block; margin-top: 6px; }
</style>
