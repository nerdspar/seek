<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Poster from './Poster.svelte';
	import Skeleton from './Skeleton.svelte';
	import {
		coverThumb,
		statusLabel,
		requestLabel,
		requestActive,
		requestCancellable,
		type BookCard,
		type BookDetail,
		type BookRequest,
		type ReadingBook,
		type RequestMediaKind
	} from '$lib/books';

	/** A book's sheet. Opened from the reading list (`library`: your copy in
	 *  BookOrbit) or from Discover (`card`: a Hardcover result). Either way, when
	 *  the book has a Hardcover id the sheet fills in the description, genres and
	 *  series from Hardcover. Read-only for now. */
	type Owned = { bookId: number; status: ReadingBook['status']; progress: number | null };
	type Props = {
		hardcoverId: number | null;
		library?: ReadingBook | null;
		card?: (BookCard & { owned?: Owned | null; wished?: boolean }) | null;
		onclose: () => void;
		/** Called after your status on this book changed, so the list can refresh. */
		onchange?: () => void;
	};
	let { hardcoverId, library = null, card = null, onclose, onchange }: Props = $props();

	type Detail = BookDetail & {
		owned: Owned | null;
		wished?: boolean;
		canRequest?: boolean;
		request?: BookRequest | null;
	};
	let detail = $state<Detail | null>(null);
	let loading = $state(false);
	let failed = $state(false);

	/* The Hardcover id: given, or — for a library book BookOrbit hasn't matched
	   yet — looked up by exact title + author (null when it can't be sure). */
	let matchedId = $state<number | null>(null);
	const resolvedId = $derived(hardcoverId ?? matchedId);

	$effect(() => {
		if (hardcoverId || !library) return;
		let cancelled = false;
		loading = true;
		const params = new URLSearchParams({ title: library.title });
		if (library.authors[0]) params.set('author', library.authors[0]);
		fetch(`/api/books/match?${params}`)
			.then((r) => (r.ok ? r.json() : { hardcoverId: null }))
			.then((b) => {
				if (cancelled) return;
				matchedId = b.hardcoverId ?? null;
				// No match: nothing more to load.
				if (!matchedId) loading = false;
			})
			.catch(() => !cancelled && (loading = false));
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const id = resolvedId;
		if (!id) return;
		let cancelled = false;
		loading = true;
		failed = false;
		fetch(`/api/books/detail/${id}`)
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((d) => !cancelled && (detail = d))
			.catch(() => !cancelled && (failed = true))
			.finally(() => !cancelled && (loading = false));
		return () => {
			cancelled = true;
		};
	});

	/* What we know immediately (from where it was tapped) vs. what the detail adds. */
	const title = $derived(detail?.title ?? library?.title ?? card?.title ?? '');
	const authors = $derived(
		library?.authors.length ? library.authors.join(', ') : (detail?.author ?? card?.author ?? null)
	);
	const cover = $derived(library?.coverUrl ?? detail?.coverUrl ?? card?.coverUrl ?? null);
	const year = $derived(library?.year ?? detail?.year ?? card?.year ?? null);
	const pages = $derived(library?.pageCount ?? detail?.pages ?? null);
	const rating = $derived(detail?.rating ?? card?.rating ?? null);
	const series = $derived(
		detail?.series ??
			(library?.seriesName ? { name: library.seriesName, position: library.seriesIndex } : null)
	);

	/* Your copy: from the reading list directly, or the ownership Discover found. */
	const mine = $derived(
		library
			? { status: library.status, progress: library.progress }
			: (detail?.owned ?? card?.owned ?? null)
	);

	let expanded = $state(false);
	const pct = (p: number) => `${Math.round(p * 100)}%`;

	/* ── Your status on a book you own (BookOrbit, per person) ─────────────── */
	const ownedId = $derived(library?.id ?? detail?.owned?.bookId ?? card?.owned?.bookId ?? null);
	let picked = $state<ReadingBook['status'] | null>(null);
	const status = $derived(picked ?? mine?.status ?? null);
	let saving = $state(false);
	let saveError = $state<string | null>(null);

	const PRIMARY: { id: ReadingBook['status']; label: string }[] = [
		{ id: 'want_to_read', label: 'Want to read' },
		{ id: 'reading', label: 'Reading' },
		{ id: 'read', label: 'Read' }
	];
	const SECONDARY: { id: ReadingBook['status']; label: string }[] = [
		{ id: 'on_hold', label: 'On hold' },
		{ id: 'abandoned', label: "Didn't finish" },
		{ id: 'unread', label: 'Clear' }
	];

	async function setStatus(next: ReadingBook['status']) {
		if (!ownedId || saving || next === status) return;
		const before = picked;
		picked = next; // optimistic
		saving = true;
		saveError = null;
		try {
			const res = await fetch('/api/books/status', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ bookId: ownedId, status: next })
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			onchange?.();
		} catch (e) {
			picked = before;
			saveError = `Couldn't save — ${(e as Error).message}`;
		} finally {
			saving = false;
		}
	}

	/* ── Shelves: your BookOrbit collections, for a book you own ───────────── */
	type ShelfMark = { id: number; name: string; count: number; has: boolean };
	let shelves = $state<ShelfMark[] | null>(null);
	let shelfBusy = $state(false);
	let naming = $state(false);
	let newName = $state('');

	$effect(() => {
		const id = ownedId;
		if (!id) return;
		let cancelled = false;
		fetch(`/api/books/shelves?bookId=${id}`)
			.then((r) => (r.ok ? r.json() : { shelves: [] }))
			.then((b) => !cancelled && (shelves = b.shelves))
			.catch(() => !cancelled && (shelves = []));
		return () => {
			cancelled = true;
		};
	});

	async function toggleShelf(sh: ShelfMark) {
		if (!ownedId || shelfBusy) return;
		shelfBusy = true;
		saveError = null;
		const on = !sh.has;
		sh.has = on; // optimistic
		try {
			const res = await fetch(`/api/books/shelves/${sh.id}/books`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ bookId: ownedId, on })
			});
			if (!res.ok) throw new Error(await failure(res));
		} catch (e) {
			sh.has = !on;
			saveError = `Couldn't change the shelf — ${(e as Error).message}`;
		} finally {
			shelfBusy = false;
		}
	}

	async function newShelf() {
		const name = newName.trim();
		if (!name || !ownedId || shelfBusy) return;
		shelfBusy = true;
		saveError = null;
		try {
			const res = await fetch('/api/books/shelves', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			});
			if (!res.ok) throw new Error(await failure(res));
			const { shelf } = (await res.json()) as { shelf: ShelfMark };
			const mark = { ...shelf, has: false };
			shelves = [...(shelves ?? []), mark];
			naming = false;
			newName = '';
			shelfBusy = false;
			await toggleShelf(shelves[shelves.length - 1]);
		} catch (e) {
			saveError = `Couldn't make the shelf — ${(e as Error).message}`;
		} finally {
			shelfBusy = false;
		}
	}

	/* ── Send to Kindle (or any device you set up in BookOrbit) ────────────── */
	type Device = { id: number; name: string; kind: string | null };
	type Sent = { status: 'pending' | 'sent' | 'failed'; to: string; error: string | null; at: string };
	let devices = $state<Device[] | null>(null);
	let lastSent = $state<Sent | null>(null);
	let sending = $state<number | null>(null);

	$effect(() => {
		const id = ownedId;
		if (!id) return;
		let cancelled = false;
		fetch(`/api/books/send?bookId=${id}`)
			.then((r) => (r.ok ? r.json() : { devices: [], last: null }))
			.then((b) => {
				if (cancelled) return;
				devices = b.devices;
				lastSent = b.last;
			})
			.catch(() => !cancelled && (devices = []));
		return () => {
			cancelled = true;
		};
	});

	async function send(d: Device) {
		if (!ownedId || sending) return;
		sending = d.id;
		saveError = null;
		try {
			const res = await fetch('/api/books/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ bookId: ownedId, deviceId: d.id })
			});
			if (!res.ok) throw new Error(await failure(res));
			lastSent = { status: 'pending', to: d.name, error: null, at: new Date().toISOString() };
		} catch (e) {
			saveError = `Couldn't send — ${(e as Error).message}`;
		} finally {
			sending = null;
		}
	}
	const sentWhen = (iso: string) =>
		iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

	/* ── Wishlist: wanting a book you don't own (Seek's own, per person) ──── */
	let wishPicked = $state<boolean | null>(null);
	const wished = $derived(wishPicked ?? detail?.wished ?? card?.wished ?? false);

	async function toggleWish() {
		if (!resolvedId || saving) return;
		const next = !wished;
		const before = wishPicked;
		wishPicked = next; // optimistic
		saving = true;
		saveError = null;
		try {
			const res = await fetch('/api/books/wishlist', {
				method: next ? 'POST' : 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(
					next
						? {
								hardcoverId: resolvedId,
								title: detail?.title ?? card?.title,
								author: detail?.author ?? card?.author ?? null,
								coverUrl: detail?.coverUrl ?? card?.coverUrl ?? null,
								year: detail?.year ?? card?.year ?? null
							}
						: { hardcoverId: resolvedId }
				)
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			onchange?.();
		} catch (e) {
			wishPicked = before;
			saveError = `Couldn't save — ${(e as Error).message}`;
		} finally {
			saving = false;
		}
	}

	/* ── Requests: ask BookOrbit to get it (its approval + Prowlarr do the rest) ── */
	let reqPicked = $state<BookRequest | null | undefined>(undefined);
	const request = $derived(reqPicked !== undefined ? reqPicked : (detail?.request ?? null));
	let reqNote = $state<string | null>(null);

	/** The server's own words when it refuses (BookOrbit explains itself). */
	const failure = async (res: Response) =>
		((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `HTTP ${res.status}`;

	async function ask(mediaKind: RequestMediaKind) {
		if (!resolvedId || saving) return;
		saving = true;
		saveError = null;
		reqNote = null;
		try {
			const res = await fetch('/api/books/requests', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					hardcoverId: resolvedId,
					title: detail?.title ?? card?.title,
					author: detail?.author ?? card?.author ?? null,
					coverUrl: detail?.coverUrl ?? card?.coverUrl ?? null,
					year: detail?.year ?? card?.year ?? null,
					mediaKind
				})
			});
			if (!res.ok) throw new Error(await failure(res));
			const out = (await res.json()) as { request: BookRequest; joined: boolean };
			reqPicked = out.request;
			wishPicked = true; // asking for it puts it on your list
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

<Sheet label={title || 'Book'} {onclose} scrollable>
	<div class="pad">
		<div class="hero">
			<Poster src={coverThumb(cover, 96)} width={96} height={144} radius={8} eager />
			<div class="facts">
				<h2>{title}</h2>
				{#if authors}<p class="by">{authors}</p>{/if}
				<p class="meta tnum">
					{[year, pages ? `${pages} pages` : null, rating ? `★ ${rating.toFixed(1)}` : null]
						.filter(Boolean)
						.join(' · ')}
				</p>
				{#if series}
					<p class="series">{series.name}{series.position ? ` · Book ${series.position}` : ''}</p>
				{/if}
			</div>
		</div>

		{#if mine && ownedId}
			<div class="picker" role="radiogroup" aria-label="Your status">
				{#each PRIMARY as opt (opt.id)}
					<button
						role="radio"
						aria-checked={status === opt.id || (opt.id === 'reading' && status === 'rereading')}
						class:on={status === opt.id || (opt.id === 'reading' && status === 'rereading')}
						disabled={saving}
						onclick={() => setStatus(opt.id)}>{opt.label}</button
					>
				{/each}
			</div>
			<div class="picker2">
				{#each SECONDARY as opt (opt.id)}
					<button class:on={status === opt.id} disabled={saving} onclick={() => setStatus(opt.id)}
						>{opt.label}</button
					>
				{/each}
			</div>
			{#if mine.progress !== null && mine.progress > 0}
				<div class="mine">
					<span class="status">{status ? statusLabel(status) : ''}</span>
					<span class="track"><span class="fill" style:width={pct(mine.progress)}></span></span>
					<span class="pct tnum">{pct(mine.progress)}</span>
				</div>
			{/if}
			{#if shelves}
				<div class="shelves">
					<span class="shelfhead">Shelves</span>
					<div class="chips">
						{#each shelves as sh (sh.id)}
							<button class="chip" class:on={sh.has} aria-pressed={sh.has} disabled={shelfBusy} onclick={() => toggleShelf(sh)}>
								{sh.has ? '✓ ' : ''}{sh.name}
							</button>
						{/each}
						{#if naming}
							<form class="newshelf" onsubmit={(e) => { e.preventDefault(); void newShelf(); }}>
								<!-- svelte-ignore a11y_autofocus -->
								<input bind:value={newName} placeholder="Shelf name" maxlength="255" autofocus enterkeyhint="done" />
								<button type="submit" class="chip on" disabled={shelfBusy || !newName.trim()}>Add</button>
							</form>
						{:else}
							<button class="chip add" onclick={() => (naming = true)}>+ New shelf</button>
						{/if}
					</div>
				</div>
			{/if}
			{#if devices?.length}
				<div class="shelves">
					<span class="shelfhead">Send to</span>
					<div class="chips">
						{#each devices as d (d.id)}
							<button class="chip" disabled={sending !== null} onclick={() => send(d)}>
								{sending === d.id ? 'Sending…' : d.name}
							</button>
						{/each}
					</div>
					{#if lastSent}
						<p class="sent" class:bad={lastSent.status === 'failed'}>
							{lastSent.status === 'pending'
								? `On its way to ${lastSent.to}`
								: lastSent.status === 'sent'
									? `Sent to ${lastSent.to} · ${sentWhen(lastSent.at)}`
									: `Couldn't send to ${lastSent.to}${lastSent.error ? ` — ${lastSent.error}` : ''}`}
						</p>
					{/if}
				</div>
			{:else if devices}
				<p class="sent">To send books to your Kindle, add it in BookOrbit → Settings → Email.</p>
			{/if}
			{#if saveError}<p class="err">{saveError}</p>{/if}
		{:else if resolvedId && !library}
			<button class="wish" class:on={wished} aria-pressed={wished} disabled={saving} onclick={toggleWish}>
				{wished ? '✓ On your want-to-read list' : '+ Want to read'}
			</button>
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
			{:else if detail?.canRequest}
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
		{/if}

		{#if resolvedId || loading}
			{#if loading && !detail}
				<div class="sk"><Skeleton height="13px" /><Skeleton width="92%" height="13px" /><Skeleton width="70%" height="13px" /></div>
			{:else if detail}
				{#if detail.genres.length}
					<div class="tags">
						{#each detail.genres as g (g)}<span class="tag">{g}</span>{/each}
					</div>
				{/if}
				{#if detail.description}
					<p class="desc" class:clamped={!expanded}>{detail.description}</p>
					{#if detail.description.length > 280}
						<button class="more" onclick={() => (expanded = !expanded)}>{expanded ? 'Less' : 'More'}</button>
					{/if}
				{/if}
				{#if detail.readers}
					<p class="readers tnum">
						{detail.readers.toLocaleString()} readers on Hardcover{detail.ratingsCount
							? ` · ${detail.ratingsCount.toLocaleString()} ratings`
							: ''}
					</p>
				{/if}
			{:else if failed}
				<p class="notowned">Couldn't load more about this book from Hardcover.</p>
			{/if}
		{/if}
	</div>
</Sheet>

<style>
	.pad { padding: 4px var(--gutter) 8px; }
	.hero { display: flex; gap: 14px; align-items: flex-start; }
	.facts { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
	h2 { margin: 0; font-size: 19px; font-weight: 650; line-height: 1.25; letter-spacing: -0.01em; }
	.by { margin: 0; font-size: 14px; color: var(--text); }
	.meta, .series { margin: 0; font-size: 12.5px; color: var(--text-dim); }

	.mine {
		display: flex; align-items: center; gap: 10px;
		margin: 16px 0 4px; padding: 10px 12px;
		border-radius: var(--radius); background: var(--surface-raised);
	}
	.status { flex: none; font-size: 13.5px; font-weight: 650; }
	.track { flex: 1; height: 5px; border-radius: 3px; background: var(--surface); overflow: hidden; }
	.fill { display: block; height: 100%; border-radius: 3px; background: var(--signal); }
	.pct { flex: none; font-size: 12.5px; color: var(--text-dim); }
	.notowned { margin: 14px 0 0; font-size: 13px; color: var(--text-dim); }
	.wish {
		width: 100%; min-height: 44px; margin-top: 16px; border-radius: 11px;
		background: var(--signal); color: #fff; font-size: 14.5px; font-weight: 650;
	}
	.wish.on { background: var(--surface-raised); color: var(--text); box-shadow: inset 0 0 0 1.5px var(--signal-solid); }
	.wish:disabled { opacity: 0.7; }
	.wish + .notowned { margin-top: 8px; text-align: center; }
	.shelves { margin-top: 14px; }
	.shelfhead { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 650; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
	.chips { display: flex; flex-wrap: wrap; gap: 6px; }
	.chip {
		min-height: 32px; padding: 0 12px; border-radius: 999px;
		background: var(--surface-raised); font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.chip.on { color: var(--text); box-shadow: inset 0 0 0 1.5px var(--signal-solid); }
	.chip.add { color: var(--signal-solid); }
	.chip:disabled { opacity: 0.7; }
	.newshelf { display: flex; gap: 6px; flex: 1 1 100%; }
	.newshelf input {
		flex: 1; min-width: 0; height: 32px; padding: 0 12px; border: none; border-radius: 999px;
		background: var(--surface-raised); color: var(--text); font: inherit; font-size: 16px; outline: none;
	}
	.sent { margin: 8px 0 0; font-size: 12.5px; color: var(--text-dim); }
	.sent.bad { color: #ff8a8a; }
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
	.reqtrack { display: block; margin-top: 6px; }

	.picker {
		display: flex; gap: 3px; margin-top: 16px; padding: 3px;
		border-radius: 11px; background: var(--surface-raised);
	}
	.picker button {
		flex: 1; min-height: 40px; border-radius: 9px;
		font-size: 13.5px; font-weight: 600; color: var(--text-dim);
	}
	.picker button.on { background: var(--signal); color: #fff; }
	.picker2 { display: flex; gap: 6px; margin-top: 8px; }
	.picker2 button {
		min-height: 32px; padding: 0 12px; border-radius: 9px;
		background: var(--surface-raised); font-size: 12.5px; font-weight: 600; color: var(--text-dim);
	}
	.picker2 button.on { background: var(--surface); color: var(--text); box-shadow: inset 0 0 0 1.5px var(--signal-solid); }
	.picker button:disabled, .picker2 button:disabled { opacity: 0.7; }
	.err { margin: 8px 0 0; font-size: 13px; color: #ff8a8a; }

	.sk { display: flex; flex-direction: column; gap: 7px; margin-top: 16px; }
	.tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; }
	.tag { padding: 4px 10px; border-radius: 999px; background: var(--surface-raised); font-size: 12px; font-weight: 600; color: var(--text-dim); }
	.desc { margin: 14px 0 0; font-size: 14.5px; line-height: 1.55; white-space: pre-line; }
	.desc.clamped {
		display: -webkit-box; -webkit-line-clamp: 6; line-clamp: 6;
		-webkit-box-orient: vertical; overflow: hidden;
	}
	.more { margin-top: 4px; font-size: 13px; font-weight: 600; color: var(--signal-solid); }
	.readers { margin: 14px 0 0; font-size: 12px; color: var(--text-dim); }
</style>
