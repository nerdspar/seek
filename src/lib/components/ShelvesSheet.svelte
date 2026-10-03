<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Skeleton from './Skeleton.svelte';
	import Poster from './Poster.svelte';
	import { coverThumb, statusLabel, type ReadingBook } from '$lib/books';

	/** Your shelves (BookOrbit collections): see what's on each, make, rename
	 *  and delete them. Putting a book on a shelf happens from its sheet. */
	let { onclose }: { onclose: () => void } = $props();

	type Shelf = { id: number; name: string; count: number };
	let shelves = $state<Shelf[] | null>(null);
	let error = $state<string | null>(null);
	let busy = $state(false);

	const reason = async (r: Response) =>
		((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `HTTP ${r.status}`;

	async function load() {
		const r = await fetch('/api/books/shelves');
		if (!r.ok) throw new Error(await reason(r));
		shelves = (await r.json()).shelves;
	}
	$effect(() => {
		load().catch((e) => (error = (e as Error).message));
	});

	/* One shelf open at a time, its books fetched when opened. */
	let openId = $state<number | null>(null);
	let books = $state<ReadingBook[] | null>(null);
	async function toggle(id: number) {
		if (openId === id) {
			openId = null;
			return;
		}
		openId = id;
		books = null;
		editing = null;
		confirming = null;
		const r = await fetch(`/api/books/shelves/${id}`).catch(() => null);
		if (openId === id) books = r?.ok ? (await r.json()).books : [];
	}

	async function act(fn: () => Promise<Response>) {
		if (busy) return false;
		busy = true;
		error = null;
		try {
			const r = await fn();
			if (!r.ok) throw new Error(await reason(r));
			await load();
			return true;
		} catch (e) {
			error = (e as Error).message;
			return false;
		} finally {
			busy = false;
		}
	}

	let newName = $state('');
	async function create() {
		const name = newName.trim();
		if (!name) return;
		const ok = await act(() =>
			fetch('/api/books/shelves', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			})
		);
		if (ok) newName = '';
	}

	let editing = $state<number | null>(null);
	let editName = $state('');
	async function rename(id: number) {
		const name = editName.trim();
		if (!name) return;
		const ok = await act(() =>
			fetch(`/api/books/shelves/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			})
		);
		if (ok) editing = null;
	}

	/* Deleting asks twice: the first tap arms it. */
	let confirming = $state<number | null>(null);
	async function remove(id: number) {
		if (confirming !== id) {
			confirming = id;
			return;
		}
		const ok = await act(() => fetch(`/api/books/shelves/${id}`, { method: 'DELETE' }));
		if (ok) {
			confirming = null;
			openId = null;
		}
	}
</script>

<Sheet label="Shelves" {onclose} scrollable>
	<div class="pad">
		<h2>Shelves</h2>
		<p class="lede">Your own shelves in BookOrbit. Add a book to one from the book's sheet.</p>

		<form class="new" onsubmit={(e) => { e.preventDefault(); void create(); }}>
			<input bind:value={newName} placeholder="New shelf" maxlength="255" enterkeyhint="done" />
			<button type="submit" disabled={busy || !newName.trim()}>Add</button>
		</form>
		{#if error}<p class="err">{error}</p>{/if}

		{#if !shelves}
			{#if !error}<div class="sk"><Skeleton height="48px" radius={12} /><Skeleton height="48px" radius={12} /></div>{/if}
		{:else if !shelves.length}
			<p class="empty">No shelves yet.</p>
		{:else}
			<ul class="list">
				{#each shelves as sh (sh.id)}
					<li>
						<button class="row" aria-expanded={openId === sh.id} onclick={() => toggle(sh.id)}>
							<span class="name">{sh.name}</span>
							<span class="count tnum">{sh.count}</span>
						</button>
						{#if openId === sh.id}
							<div class="body">
								{#if editing === sh.id}
									<form class="new" onsubmit={(e) => { e.preventDefault(); void rename(sh.id); }}>
										<!-- svelte-ignore a11y_autofocus -->
										<input bind:value={editName} maxlength="255" autofocus enterkeyhint="done" />
										<button type="submit" disabled={busy || !editName.trim()}>Save</button>
									</form>
								{:else}
									<div class="tools">
										<button onclick={() => { editing = sh.id; editName = sh.name; confirming = null; }}>Rename</button>
										<button class:danger={confirming === sh.id} disabled={busy} onclick={() => remove(sh.id)}>
											{confirming === sh.id ? 'Tap again to delete' : 'Delete'}
										</button>
									</div>
								{/if}
								{#if !books}
									<Skeleton height="56px" radius={10} />
								{:else if !books.length}
									<p class="empty">Nothing on this shelf yet.</p>
								{:else}
									<ul class="books">
										{#each books as b (b.id)}
											<li>
												<Poster src={coverThumb(b.coverUrl, 34)} width={34} height={51} radius={4} />
												<span class="bt">
													<span class="btitle">{b.title}</span>
													<span class="bsub">{[b.authors[0], statusLabel(b.status)].filter(Boolean).join(' · ')}</span>
												</span>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</Sheet>

<style>
	.pad { padding: 4px var(--gutter) 12px; }
	h2 { margin: 0; font-size: 19px; font-weight: 650; letter-spacing: -0.01em; }
	.lede { margin: 4px 0 14px; font-size: 13.5px; color: var(--text-dim); }
	.sk { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
	.err { margin: 8px 0 0; font-size: 13px; color: #ff8a8a; }
	.empty { margin: 14px 0; font-size: 13.5px; color: var(--text-dim); text-align: center; }

	.new { display: flex; gap: 8px; }
	.new input {
		flex: 1; min-width: 0; height: 44px; padding: 0 14px; border: none; border-radius: 11px;
		background: var(--surface-raised); color: var(--text); font: inherit; font-size: 16px; outline: none;
	}
	.new button {
		flex: none; min-width: 64px; height: 44px; padding: 0 14px; border-radius: 11px;
		background: var(--signal); color: #fff; font-size: 14px; font-weight: 650;
	}
	.new button:disabled { opacity: 0.5; }

	.list { margin: 14px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
	.list > li { border-radius: 12px; background: var(--surface-raised); overflow: hidden; }
	.row { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 0 14px; text-align: left; }
	.name { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.count { flex: none; font-size: 13px; color: var(--text-dim); }
	.body { display: flex; flex-direction: column; gap: 10px; padding: 0 12px 12px; }
	.body .new input, .body .new button { height: 38px; }
	.tools { display: flex; gap: 6px; }
	.tools button {
		min-height: 32px; padding: 0 12px; border-radius: 9px;
		background: var(--surface); font-size: 12.5px; font-weight: 600; color: var(--text-dim);
	}
	.tools button.danger { color: #ff8a8a; box-shadow: inset 0 0 0 1.5px #ff8a8a; }
	.books { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
	.books li { display: flex; align-items: center; gap: 10px; }
	.bt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
	.btitle { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.bsub { font-size: 12px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
