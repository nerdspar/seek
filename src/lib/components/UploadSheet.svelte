<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Skeleton from './Skeleton.svelte';
	import { precheck, uploadFile, type UploadProgress, type UploadTarget } from '$lib/upload';

	/** Add book files to BookOrbit from the phone — what the old bookshelf app
	 *  did. Files go one at a time, in chunks, under your own BookOrbit account. */
	let { onclose, ondone }: { onclose: () => void; ondone?: () => void } = $props();

	type Options = {
		maxBytes: number;
		formats: string[];
		libraries: { id: number; name: string; formats: string[] }[];
		dock: boolean;
		defaultLibraryId: number | null;
		chunkBytes: number;
	};
	let options = $state<Options | null>(null);
	let loadError = $state<string | null>(null);

	$effect(() => {
		fetch('/api/books/uploads')
			.then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => null))?.message ?? `HTTP ${r.status}`))))
			.then((o: Options) => {
				options = o;
				dest = o.defaultLibraryId !== null ? `lib:${o.defaultLibraryId}` : o.libraries[0] ? `lib:${o.libraries[0].id}` : o.dock ? 'dock' : '';
			})
			.catch((e) => (loadError = (e as Error).message));
	});

	/* Where files go: a library (filed straight in) or the Book Dock (an inbox
	   to check metadata first). Shown only when there's a choice. */
	let dest = $state('');
	const choices = $derived([
		...(options?.libraries ?? []).map((l) => ({ id: `lib:${l.id}`, label: l.name })),
		...(options?.dock ? [{ id: 'dock', label: 'Book Dock — review first' }] : [])
	]);
	const target = $derived<UploadTarget | null>(
		dest === 'dock' ? { kind: 'book_dock' } : dest.startsWith('lib:') ? { kind: 'library', libraryId: Number(dest.slice(4)) } : null
	);
	/* What the chosen library takes (a library can be narrower than BookOrbit). */
	const formats = $derived.by(() => {
		const lib = options?.libraries.find((l) => `lib:${l.id}` === dest);
		return lib?.formats.length ? lib.formats : (options?.formats ?? []);
	});

	type Row = { key: string; file: File; progress: UploadProgress | null; error: string | null };
	let rows = $state<Row[]>([]);
	let busy = $state(false);
	let input: HTMLInputElement | undefined = $state();

	function pick(e: Event) {
		const files = [...((e.currentTarget as HTMLInputElement).files ?? [])];
		(e.currentTarget as HTMLInputElement).value = '';
		rows = [
			...rows,
			...files.map((file) => ({
				key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
				file,
				progress: null,
				error: options ? precheck(file, formats, options.maxBytes) : null
			}))
		];
		void run();
	}

	async function run() {
		if (busy || !options || !target) return;
		busy = true;
		let added = false;
		try {
			for (const row of rows) {
				if (row.progress || row.error) continue;
				const out = await uploadFile(row.file, target, {
					chunkBytes: options.chunkBytes,
					onProgress: (p) => (row.progress = p)
				}).catch((e) => ({ phase: 'failed' as const, sent: 0, size: row.file.size, error: (e as Error).message }));
				row.progress = out;
				if (out.phase === 'done') added = true;
			}
		} finally {
			busy = false;
		}
		if (added) ondone?.();
	}

	const pct = (p: UploadProgress) => Math.round((p.sent / Math.max(1, p.size)) * 100);
	const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
	const accept = $derived(formats.map((f) => `.${f}`).join(','));
</script>

<Sheet label="Add books" {onclose} scrollable>
	<div class="pad">
		<h2>Add books</h2>
		<p class="lede">Upload book files from this device into BookOrbit.</p>

		{#if loadError}
			<p class="err">Can't upload right now — {loadError}</p>
		{:else if !options}
			<div class="sk"><Skeleton height="44px" radius={11} /><Skeleton height="44px" radius={11} /></div>
		{:else if !choices.length}
			<p class="err">Your BookOrbit account isn't allowed to upload. Ask whoever runs BookOrbit to give it upload access.</p>
		{:else}
			{#if choices.length > 1}
				<div class="dest" role="radiogroup" aria-label="Where to put them">
					{#each choices as c (c.id)}
						<button role="radio" aria-checked={dest === c.id} class:on={dest === c.id} disabled={busy} onclick={() => (dest = c.id)}>
							{c.label}
						</button>
					{/each}
				</div>
			{/if}

			<button class="choose" disabled={busy && !rows.length} onclick={() => input?.click()}>
				{rows.length ? 'Add more files' : 'Choose files'}
			</button>
			<input bind:this={input} type="file" multiple {accept} onchange={pick} hidden />
			<p class="hint">{formats.map((f) => f.toUpperCase()).join(' · ')} · up to {mb(options.maxBytes)}</p>

			{#if rows.length}
				<ul class="files">
					{#each rows as r (r.key)}
						<li>
							<span class="name">{r.file.name}</span>
							{#if r.error}
								<span class="state bad">{r.error}</span>
							{:else if !r.progress}
								<span class="state">Waiting · {mb(r.file.size)}</span>
							{:else if r.progress.phase === 'sending'}
								<span class="bar"><span class="fill" style:width={`${pct(r.progress)}%`}></span></span>
								<span class="state tnum">{pct(r.progress)}% of {mb(r.file.size)}</span>
							{:else if r.progress.phase === 'importing'}
								<span class="state">Adding to your library…</span>
							{:else if r.progress.phase === 'done'}
								<span class="state good">✓ Added</span>
							{:else}
								<span class="state bad">{r.progress.error ?? 'Failed'}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</Sheet>

<style>
	.pad { padding: 4px var(--gutter) 12px; }
	h2 { margin: 0; font-size: 19px; font-weight: 650; letter-spacing: -0.01em; }
	.lede { margin: 4px 0 16px; font-size: 13.5px; color: var(--text-dim); }
	.sk { display: flex; flex-direction: column; gap: 10px; }

	.dest { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
	.dest button {
		min-height: 44px; padding: 0 14px; border-radius: 11px; text-align: left;
		background: var(--surface-raised); font-size: 14px; font-weight: 600; color: var(--text-dim);
	}
	.dest button.on { color: var(--text); box-shadow: inset 0 0 0 1.5px var(--signal-solid); }

	.choose {
		width: 100%; min-height: 48px; border-radius: 12px;
		background: var(--signal); color: #fff; font-size: 15px; font-weight: 650;
	}
	.choose:disabled { opacity: 0.6; }
	.hint { margin: 8px 0 0; font-size: 12px; color: var(--text-dim); text-align: center; }

	.files { margin: 18px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
	.files li {
		display: flex; flex-direction: column; gap: 5px;
		padding: 10px 12px; border-radius: 12px; background: var(--surface-raised);
	}
	.name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.state { font-size: 12.5px; color: var(--text-dim); }
	.state.good { color: var(--text); font-weight: 600; }
	.state.bad, .err { color: #ff8a8a; }
	.err { font-size: 13.5px; }
	.bar { display: block; height: 5px; border-radius: 3px; background: var(--surface); overflow: hidden; }
	.fill { display: block; height: 100%; border-radius: 3px; background: var(--signal); transition: width 200ms ease; }
</style>
