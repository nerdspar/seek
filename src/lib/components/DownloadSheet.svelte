<script lang="ts">
	import { untrack } from 'svelte';
	import Sheet from './Sheet.svelte';
	import {
		emptySearchReason,
		requestActive,
		requestCancellable,
		requestLabel,
		type BookCard,
		type BookRelease,
		type BookRequest,
		type ReleaseSearch,
		type RequestMediaKind
	} from '$lib/books';

	/**
	 * Download a book — the ebook or the audiobook — through BookOrbit (its
	 * download sources are your Prowlarr indexers). Automatic grabs the best
	 * match; Choose lists what your sources found. Then it watches: searching,
	 * downloading %, adding to your library — and when something can't be found
	 * or fails, it says so in words, never just stops.
	 */
	type Props = {
		book: Pick<BookCard, 'hardcoverId' | 'title' | 'author' | 'coverUrl' | 'year'>;
		kind: RequestMediaKind;
		/** A request already under way for this book: open straight to watching it. */
		existing?: BookRequest | null;
		onclose: () => void;
		onchange?: () => void;
	};
	let { book, kind, existing = null, onclose, onchange }: Props = $props();

	type Step = 'starting' | 'ready' | 'searching' | 'choose' | 'grabbing' | 'watching' | 'queued' | 'error';
	// Where it starts is decided once; the sheet is keyed per book by its callers.
	const initial = untrack(() => existing);
	let step = $state<Step>(initial ? 'watching' : 'starting');
	let request = $state<BookRequest | null>(initial);
	let search = $state<ReleaseSearch | null>(null);
	let problem = $state<string | null>(null);
	let note = $state<string | null>(null);

	const reason = async (res: Response) =>
		((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
	const post = (url: string, body: unknown = {}) =>
		fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	const kindWord = $derived(kind === 'audiobook' ? 'audiobook' : 'ebook');

	/* 1. Start: a self-serve request (or, without that permission, an ordinary one). */
	$effect(() => {
		if (step !== 'starting') return;
		void (async () => {
			try {
				const res = await post('/api/books/download', { ...book, mediaKind: kind });
				if (!res.ok) throw new Error(await reason(res));
				const out = (await res.json()) as { request: BookRequest; joined: boolean; selfServe: boolean };
				request = out.request;
				onchange?.();
				if (out.joined) note = 'Someone already asked for this one — you’re on that request too.';
				if (!out.selfServe) step = 'queued';
				else if (['grabbed', 'downloading', 'importing', 'available', 'needs_review'].includes(out.request.status)) step = 'watching';
				else step = 'ready';
			} catch (e) {
				problem = (e as Error).message;
				step = 'error';
			}
		})();
	});

	async function automatic() {
		if (!request) return;
		step = 'searching';
		problem = null;
		try {
			const res = await post(`/api/books/download/${request.id}/grab`, { auto: true });
			if (!res.ok) throw new Error(await reason(res));
			const out = (await res.json()) as { grabbed: boolean; reason?: string; request?: BookRequest; release?: BookRelease; search?: ReleaseSearch };
			if (!out.grabbed) {
				// Nothing fit: say why, and offer the list (there may be near misses).
				problem = out.reason ?? 'Nothing to download.';
				search = out.search ?? null;
				step = search?.releases.length ? 'choose' : 'ready';
				return;
			}
			request = out.request ?? request;
			note = out.release ? `Downloading “${out.release.title}” from ${out.release.source}.` : null;
			step = 'watching';
			onchange?.();
		} catch (e) {
			problem = `Couldn't download — ${(e as Error).message}`;
			step = 'ready';
		}
	}

	async function choose() {
		if (!request) return;
		step = 'searching';
		problem = null;
		try {
			const res = await post(`/api/books/download/${request.id}/search`);
			if (!res.ok) throw new Error(await reason(res));
			search = (await res.json()) as ReleaseSearch;
			if (!search.releases.length) problem = emptySearchReason(search);
			step = 'choose';
		} catch (e) {
			problem = `Search failed — ${(e as Error).message}`;
			step = 'ready';
		}
	}

	async function grab(r: BookRelease) {
		if (!request) return;
		step = 'grabbing';
		problem = null;
		try {
			const res = await post(`/api/books/download/${request.id}/grab`, { indexerId: r.indexerId, guid: r.guid });
			if (!res.ok) throw new Error(await reason(res));
			request = ((await res.json()) as { request: BookRequest }).request;
			note = `Downloading “${r.title}” from ${r.source}.`;
			step = 'watching';
			onchange?.();
		} catch (e) {
			problem = `Couldn't send it to the download client — ${(e as Error).message}`;
			step = 'choose';
		}
	}

	/* Watch it until it settles: downloaded and added, or failed (with why). */
	$effect(() => {
		if (step !== 'watching' || !request) return;
		const id = request.id;
		let live = true;
		const tick = async () => {
			if (!live) return;
			try {
				const res = await fetch(`/api/books/requests/${id}`);
				if (res.ok) {
					const next = ((await res.json()) as { request: BookRequest }).request;
					const settled = !requestActive(next.status);
					if (next.status !== request?.status && settled) onchange?.();
					request = next;
					if (settled) return;
				}
			} catch {
				/* a missed poll is fine; try again */
			}
			if (live) timer = setTimeout(tick, 3000);
		};
		let timer = setTimeout(tick, 1500);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	});

	async function cancel() {
		if (!request) return;
		try {
			const res = await post(`/api/books/requests/${request.id}/cancel`);
			if (!res.ok) throw new Error(await reason(res));
			request = ((await res.json()) as { request: BookRequest }).request;
			onchange?.();
		} catch (e) {
			problem = `Couldn't cancel — ${(e as Error).message}`;
		}
	}

	const size = (b: number | null) =>
		b === null ? null : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
	const pct = (p: number) => `${Math.round(p * 100)}%`;
</script>

<Sheet label={`Download ${kindWord}`} {onclose} scrollable>
	<div class="pad">
		<h2>Download {kindWord}</h2>
		<p class="sub">{book.title}{book.author ? ` · ${book.author}` : ''}</p>

		{#if step === 'starting'}
			<p class="state">Getting ready…</p>
		{:else if step === 'error'}
			<p class="bad">{problem}</p>
		{:else if step === 'queued' && request}
			<div class="status">
				<span class="label">{requestLabel(request.status)}</span>
				<span class="hint">Your BookOrbit account can’t download directly, so this went to whoever approves requests. It’ll show on your list as it moves.</span>
			</div>
		{:else if step === 'ready'}
			<button class="primary" onclick={automatic}>
				<span class="big">Automatic</span>
				<span class="small">Get the best match from your sources</span>
			</button>
			<button class="secondary" onclick={choose}>
				<span class="big">Choose a release</span>
				<span class="small">See what your sources found</span>
			</button>
		{:else if step === 'searching'}
			<p class="state">Searching your sources… this can take a minute.</p>
		{:else if step === 'grabbing'}
			<p class="state">Sending it to the download client…</p>
		{:else if step === 'choose' && search}
			{#if search.failures.length}<p class="warn">{search.failures.join('; ')}.</p>{/if}
			{#if search.releases.length}
				<ul class="releases">
					{#each search.releases as r (r.indexerId + r.guid)}
						<li>
							<button disabled={r.alreadyGrabbed || r.vipOnly} onclick={() => grab(r)}>
								<span class="rtitle">{r.title}</span>
								<span class="rmeta tnum">
									{[r.format?.toUpperCase(), size(r.sizeBytes), r.seeders !== null ? `${r.seeders} seeders` : null, r.source].filter(Boolean).join(' · ')}
								</span>
								{#if r.alreadyGrabbed}<span class="rwarn">Already grabbed</span>
								{:else if r.vipOnly}<span class="rwarn">VIP only on this tracker</span>
								{:else if r.mismatch}<span class="rwarn">Outside your profile: {r.mismatch}</span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			<button class="link" onclick={choose}>Search again</button>
		{:else if step === 'watching' && request}
			<div class="status">
				<span class="label">{request.status === 'available' ? '✓ In your library' : requestLabel(request.status)}</span>
				{#if request.progress !== null && requestActive(request.status)}
					<span class="track"><span class="fill" style:width={pct(request.progress)}></span></span>
					<span class="hint tnum">{pct(request.progress)} downloaded</span>
				{:else if requestActive(request.status)}
					<span class="hint">Watching it — you can close this; it carries on.</span>
				{/if}
				{#if request.status === 'failed' || request.status === 'rejected'}
					<span class="bad">{request.reason ?? 'It didn’t work out.'}</span>
				{/if}
				{#if request.status === 'needs_review'}
					<span class="hint">BookOrbit wasn’t sure the download is this book — check it in BookOrbit’s Requests.</span>
				{/if}
			</div>
			<div class="row">
				{#if request.status === 'failed'}
					<button class="link" onclick={() => (step = 'ready')}>Try another release</button>
				{/if}
				{#if requestCancellable(request.status) && request.status !== 'failed'}
					<button class="link danger" onclick={cancel}>Cancel download</button>
				{/if}
			</div>
		{/if}

		{#if note}<p class="note">{note}</p>{/if}
		{#if problem && step !== 'error'}<p class="bad">{problem}</p>{/if}
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter) 14px; }
	h2 { margin: 0; font-size: 18px; font-weight: 600; }
	.sub { margin: 2px 0 16px; font-size: 13px; color: var(--text-dim); }
	.state, .note { font-size: 14px; color: var(--text-dim); }
	.note { font-size: 12.5px; margin: 10px 0 0; }
	.bad { margin: 10px 0 0; font-size: 13.5px; color: #ff8a8a; }
	.warn { margin: 0 0 10px; font-size: 12.5px; color: #f5b84a; }
	.primary, .secondary {
		display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
		width: 100%; padding: 12px 16px; border-radius: 14px; text-align: left; margin-bottom: 8px;
	}
	.primary { background: var(--signal); color: #fff; }
	.secondary { background: var(--surface-raised); color: var(--text); }
	.big { font-size: 15.5px; font-weight: 650; }
	.small { font-size: 12.5px; opacity: 0.8; }
	.releases { margin: 0 0 8px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
	.releases button {
		display: flex; flex-direction: column; gap: 3px; width: 100%;
		padding: 10px 12px; border-radius: 12px; background: var(--surface-raised); text-align: left;
	}
	.releases button:disabled { opacity: 0.5; }
	.rtitle { font-size: 13.5px; font-weight: 600; word-break: break-word; }
	.rmeta { font-size: 12px; color: var(--text-dim); }
	.rwarn { font-size: 12px; color: #f5b84a; }
	.status { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border-radius: 12px; background: var(--surface-raised); }
	.label { font-size: 15px; font-weight: 650; }
	.hint { font-size: 12.5px; color: var(--text-dim); line-height: 1.4; }
	.track { height: 6px; border-radius: 3px; background: var(--surface); overflow: hidden; }
	.fill { display: block; height: 100%; border-radius: 3px; background: var(--signal); }
	.row { display: flex; gap: 18px; margin-top: 10px; }
	.link { font-size: 13.5px; font-weight: 600; color: var(--signal-solid); }
	.link.danger { color: #ff8a8a; }
</style>
