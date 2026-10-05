<script lang="ts">
	import { untrack } from 'svelte';
	import Sheet from './Sheet.svelte';
	import {
		emptySearchReason,
		requestActive,
		requestLabel,
		type BookCard,
		type BookRelease,
		type BookRequest,
		type DownloadReview,
		type ReleaseSearch,
		type RequestMediaKind
	} from '$lib/books';

	/**
	 * Download a book — the ebook or the audiobook — through BookOrbit (its
	 * download sources are your Prowlarr indexers). Automatic grabs the best
	 * match; Choose lists what your sources found. Then it watches: downloading,
	 * adding to your library — and when BookOrbit isn't sure the download is the
	 * right book, the comparison and the decision (file it / discard it) are
	 * right here. Anything that can't be found or fails says why, in words.
	 *
	 * Nothing is asked of BookOrbit until you choose Automatic or Choose, and if
	 * you close the sheet without grabbing anything, the request is called off
	 * and hidden again — so it never sits "approved" for a book you didn't get.
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

	type Step = 'ready' | 'searching' | 'choose' | 'grabbing' | 'watching' | 'queued';
	// Where it starts is decided once; the sheet is keyed per book by its callers.
	const initial = untrack(() => existing);
	let step = $state<Step>(initial ? 'watching' : 'ready');
	let request = $state<BookRequest | null>(initial);
	let search = $state<ReleaseSearch | null>(null);
	let problem = $state<string | null>(null);
	let note = $state<string | null>(null);
	let bookorbitUrl = $state<string | null>(null);
	/* A request this sheet made that nothing has been grabbed for yet — the one
	   to call off if you leave. */
	let unused = $state(false);

	const reason = async (res: Response) =>
		((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
	const post = (url: string, body: unknown = {}) =>
		fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
	const kindWord = $derived(kind === 'audiobook' ? 'audiobook' : 'ebook');

	/** Make the request (once): self-serve, or — without that permission — one
	 *  that waits for approval. Returns false when there's nothing more to do here. */
	async function ensureRequest(): Promise<boolean> {
		if (request) return true;
		const res = await post('/api/books/download', { ...book, mediaKind: kind });
		if (!res.ok) throw new Error(await reason(res));
		const out = (await res.json()) as { request: BookRequest; joined: boolean; selfServe: boolean; bookorbitUrl: string | null };
		request = out.request;
		bookorbitUrl = out.bookorbitUrl;
		if (out.joined) note = 'Someone already asked for this one — you’re on that request too.';
		if (!out.selfServe) {
			step = 'queued';
			onchange?.();
			return false;
		}
		if (['grabbed', 'downloading', 'importing', 'available', 'needs_review'].includes(out.request.status)) {
			step = 'watching';
			return false;
		}
		unused = !out.joined;
		return true;
	}

	async function automatic() {
		step = 'searching';
		problem = null;
		try {
			if (!(await ensureRequest())) return;
			const res = await post(`/api/books/download/${request!.id}/grab`, { auto: true });
			if (!res.ok) throw new Error(await reason(res));
			const out = (await res.json()) as { grabbed: boolean; reason?: string; request?: BookRequest; release?: BookRelease; search?: ReleaseSearch };
			if (!out.grabbed) {
				// Nothing fit: say why, and offer the list (there may be near misses).
				problem = out.reason ?? 'Nothing to download.';
				search = out.search ?? null;
				step = search?.releases.length ? 'choose' : 'ready';
				return;
			}
			unused = false;
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
		step = 'searching';
		problem = null;
		try {
			if (!(await ensureRequest())) return;
			const res = await post(`/api/books/download/${request!.id}/search`);
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
			unused = false;
			request = ((await res.json()) as { request: BookRequest }).request;
			note = `Downloading “${r.title}” from ${r.source}.`;
			step = 'watching';
			onchange?.();
		} catch (e) {
			problem = `Couldn't send it to the download client — ${(e as Error).message}`;
			step = 'choose';
		}
	}

	/** Leaving without grabbing anything calls the request off (best-effort). */
	function close() {
		if (unused && request) void post(`/api/books/download/${request.id}/abandon`).catch(() => {});
		onclose();
	}

	/* Watch it until it settles: added to the library, held for review, or failed. */
	$effect(() => {
		if (step !== 'watching' || !request) return;
		const id = request.id;
		let live = true;
		let timer: ReturnType<typeof setTimeout>;
		const tick = async () => {
			if (!live) return;
			try {
				const res = await fetch(`/api/books/requests/${id}`);
				if (res.ok) {
					const body = (await res.json()) as { request: BookRequest; bookorbitUrl: string | null };
					const next = body.request;
					bookorbitUrl = body.bookorbitUrl ?? bookorbitUrl;
					if (next.status !== request?.status && (next.status === 'available' || next.status === 'needs_review')) onchange?.();
					request = next;
					// Held for review is a stop too: it waits on you, not on the download.
					if (!requestActive(next.status) || next.status === 'needs_review') return;
				}
			} catch {
				/* a missed poll is fine; try again */
			}
			if (live) timer = setTimeout(tick, 3000);
		};
		timer = setTimeout(tick, 1500);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	});

	/* ── Held for review: what you asked for vs what arrived ──────────────── */
	let review = $state<DownloadReview | null>(null);
	let reviewFailed = $state(false);
	let deciding = $state(false);
	$effect(() => {
		if (request?.status !== 'needs_review' || review) return;
		const id = request.id;
		reviewFailed = false;
		fetch(`/api/books/download/${id}/review`)
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((b) => (review = b.review))
			// Often it's just been settled (filed or discarded in BookOrbit) and the
			// next look at the request shows that — so this only shows while it's
			// still waiting on you.
			.catch(() => (reviewFailed = true));
	});

	async function decide(action: 'file' | 'discard') {
		if (!request || deciding) return;
		deciding = true;
		problem = null;
		try {
			const res = await post(`/api/books/download/${request.id}/review`, { action });
			if (!res.ok) throw new Error(await reason(res));
			request = ((await res.json()) as { request: BookRequest }).request;
			review = null;
			note = action === 'file' ? 'Filed into your library.' : 'Discarded. Try another release if you like.';
			onchange?.();
		} catch (e) {
			problem = `Couldn't ${action === 'file' ? 'file it' : 'discard it'} — ${(e as Error).message}`;
		} finally {
			deciding = false;
		}
	}

	async function stop() {
		if (!request) return;
		try {
			const res = await post(`/api/books/requests/${request.id}/cancel`);
			if (!res.ok) throw new Error(await reason(res));
			request = ((await res.json()) as { request: BookRequest }).request;
			onchange?.();
		} catch (e) {
			problem = `Couldn't stop it — ${(e as Error).message}`;
		}
	}

	const size = (b: number | null) =>
		b === null ? null : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
	const pct = (p: number) => `${Math.round(p * 100)}%`;
	const statusText = (r: BookRequest) =>
		r.status === 'available'
			? '✓ In my library'
			: r.status === 'importing'
				? 'Downloaded — adding to your library'
				: r.status === 'needs_review'
					? 'Downloaded — is this the right book?'
					: requestLabel(r.status);
	const inBookOrbit = $derived(bookorbitUrl && request ? `${bookorbitUrl}/requests/${request.id}` : null);
</script>

<Sheet label={`Download ${kindWord}`} onclose={close} scrollable>
	<div class="pad">
		<h2>Download {kindWord}</h2>
		<p class="sub">{book.title}{book.author ? ` · ${book.author}` : ''}</p>

		{#if step === 'queued' && request}
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
				<span class="label">{statusText(request)}</span>
				{#if request.progress !== null && (request.status === 'grabbed' || request.status === 'downloading')}
					<span class="track"><span class="fill" style:width={pct(request.progress)}></span></span>
					<span class="hint tnum">{pct(request.progress)} downloaded</span>
				{:else if requestActive(request.status) && request.status !== 'needs_review'}
					<span class="hint">Watching it — you can close this; it carries on.</span>
				{/if}
				{#if request.status === 'failed' || request.status === 'rejected'}
					<span class="bad">{request.reason ?? 'It didn’t work out.'}</span>
				{/if}
			</div>

			{#if request.status === 'needs_review'}
				<!-- BookOrbit held it: show its comparison, and let you decide here. -->
				<div class="review">
					{#if review?.reason}<p class="why">BookOrbit isn’t sure: {review.reason}.</p>{/if}
					{#if review?.rows.length}
						<table>
							<thead><tr><th></th><th>You asked for</th><th>Arrived</th></tr></thead>
							<tbody>
								{#each review.rows as row (row.field)}
									<tr class={row.verdict}>
										<th scope="row">{row.verdict === 'match' ? '✓' : row.verdict === 'mismatch' ? '✕' : '–'} {row.field}</th>
										<td>{row.requested ?? 'Not set'}</td>
										<td>{row.imported ?? '—'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
					{#if review?.files.length}
						<p class="files">{review.files.map((f) => `${f.name}${f.sizeBytes ? ` · ${size(f.sizeBytes)}` : ''}`).join(' · ')}</p>
					{/if}
					{#if review?.gone}
						<p class="hint">The download is no longer in BookOrbit’s Book Dock — it was filed or discarded there.</p>
					{:else}
						<div class="decide">
							<button class="primary small" disabled={deciding || (review !== null && !review.canFile)} onclick={() => decide('file')}>It’s right — file it</button>
							<button class="danger small" disabled={deciding} onclick={() => decide('discard')}>Wrong book — discard</button>
						</div>
						{#if review && !review.canFile}<p class="hint">There’s no library to file it into — choose one in BookOrbit.</p>{/if}
					{/if}
				</div>
			{/if}

			<div class="row">
				{#if request.status === 'failed' || request.status === 'cancelled'}
					<button class="link" onclick={() => { request = null; review = null; note = null; step = 'ready'; }}>Try again</button>
				{/if}
				{#if request.status === 'grabbed' || request.status === 'downloading'}
					<button class="link danger" onclick={stop}>Stop download</button>
				{:else if request.status === 'approved' || request.status === 'searching' || request.status === 'pending'}
					<button class="link danger" onclick={stop}>Cancel request</button>
				{/if}
				{#if inBookOrbit}<a class="link" href={inBookOrbit} target="_blank" rel="noreferrer">Open in BookOrbit ↗</a>{/if}
			</div>
		{/if}

		{#if note}<p class="note">{note}</p>{/if}
		{#if reviewFailed && request?.status === 'needs_review'}<p class="bad">Couldn’t load what BookOrbit found — open it in BookOrbit to decide.</p>{/if}
		{#if problem}<p class="bad">{problem}</p>{/if}
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
	.review { margin-top: 10px; padding: 12px 14px; border-radius: 12px; background: var(--surface-raised); }
	.why { margin: 0 0 10px; font-size: 13px; line-height: 1.45; }
	table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
	th, td { padding: 6px 4px; text-align: left; vertical-align: top; border-top: 1px solid color-mix(in srgb, var(--text) 8%, transparent); }
	thead th { border-top: none; font-weight: 600; color: var(--text-dim); }
	tbody th { white-space: nowrap; font-weight: 600; }
	tr.mismatch td:last-child { color: #ff8a8a; }
	tr.match th { color: var(--signal-solid); }
	.files { margin: 8px 0 0; font-size: 12px; color: var(--text-dim); word-break: break-word; }
	.decide { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
	.primary.small, .danger.small {
		display: inline-flex; align-items: center; width: auto; margin: 0; padding: 0 14px; min-height: 40px;
		border-radius: 10px; font-size: 13.5px; font-weight: 650;
	}
	.danger.small { background: transparent; color: #ff8a8a; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, #ff8a8a 60%, transparent); }
	button:disabled { opacity: 0.5; }
	.row { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 10px; }
	.link { font-size: 13.5px; font-weight: 600; color: var(--signal-solid); text-decoration: none; }
	.link.danger { color: #ff8a8a; }
</style>
