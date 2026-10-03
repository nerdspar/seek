<script lang="ts">
	/** The extras for a book in your library: which of your shelves (BookOrbit
	 *  collections) it's on, and sending it to your Kindle or other devices. */
	let { bookId }: { bookId: number } = $props();

	let saveError = $state<string | null>(null);

	/** The server's own words when it refuses (BookOrbit explains itself). */
	const failure = async (res: Response) =>
		((await res.json().catch(() => null)) as { message?: string } | null)?.message ?? `HTTP ${res.status}`;

	/* ── Shelves: your BookOrbit collections, for a book you own ───────────── */
	type ShelfMark = { id: number; name: string; count: number; has: boolean };
	let shelves = $state<ShelfMark[] | null>(null);
	let shelfBusy = $state(false);
	let naming = $state(false);
	let newName = $state('');

	$effect(() => {
		const id = bookId;
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
		if (!bookId || shelfBusy) return;
		shelfBusy = true;
		saveError = null;
		const on = !sh.has;
		sh.has = on; // optimistic
		try {
			const res = await fetch(`/api/books/shelves/${sh.id}/books`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ bookId: bookId, on })
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
		if (!name || !bookId || shelfBusy) return;
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
		const id = bookId;
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
		if (!bookId || sending) return;
		sending = d.id;
		saveError = null;
		try {
			const res = await fetch('/api/books/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ bookId: bookId, deviceId: d.id })
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

</script>

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
{/if}
{#if saveError}<p class="err">{saveError}</p>{/if}

<style>
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
	.err { margin: 8px 0 0; font-size: 13px; color: #ff8a8a; }
</style>
