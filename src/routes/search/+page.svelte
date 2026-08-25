<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import AddButton from '$lib/components/AddButton.svelte';
	import type { SearchResult } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Scope = 'best' | 'tv' | 'movie';
	const CHIPS: { id: Scope; label: string }[] = [
		{ id: 'best', label: 'Best Match' },
		{ id: 'tv', label: 'TV Shows' },
		{ id: 'movie', label: 'Movies' }
	];

	/* Seeded from ?q= so links into search — tapping an actor on a show page —
	   arrive with the query already run. */
	let query = $state(page.url.searchParams.get('q') ?? '');
	let scope = $state<Scope>('best');
	let results = $state<SearchResult[]>([]);
	let searching = $state(false);
	let failed = $state<string | null>(null);
	let added = $state<Record<string, boolean>>({});
	let busy = $state<Set<string>>(new Set());
	let input: HTMLInputElement | undefined = $state();

	const key = (r: SearchResult) => `${r.mediaType}:${r.source}:${r.mediaId}`;

	$effect(() => {
		input?.focus();
	});

	/* §6.4: live search, firing 1s after typing stops. The debounce is the
	   point — every keystroke would hammer TMDB through Floppy for results the
	   user is still in the middle of describing. */
	let seq = 0;
	$effect(() => {
		const q = query.trim();
		const s = scope;

		if (!q) {
			results = [];
			searching = false;
			failed = null;
			return;
		}

		searching = true;
		const mine = ++seq;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&scope=${s}`);
				if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
				const body = await res.json();
				// Ignore a response that a newer keystroke has already superseded.
				if (mine !== seq) return;
				results = body.results;
				failed = null;
			} catch (err) {
				if (mine === seq) failed = err instanceof Error ? err.message : String(err);
			} finally {
				if (mine === seq) searching = false;
			}
		}, 1000);

		return () => clearTimeout(timer);
	});

	async function toggleAdd(r: SearchResult) {
		const k = key(r);
		if (busy.has(k)) return;
		const isAdded = added[k] ?? r.tracked;

		const next = new Set(busy);
		next.add(k);
		busy = next;
		added = { ...added, [k]: !isAdded };

		try {
			const res = await fetch('/api/library', {
				method: isAdded ? 'DELETE' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: r.mediaType, source: r.source, mediaId: r.mediaId })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
		} catch (err) {
			added = { ...added, [k]: isAdded };
			failed = err instanceof Error ? err.message : String(err);
		} finally {
			const done = new Set(busy);
			done.delete(k);
			busy = done;
		}
	}

	const isAdded = (r: SearchResult) => added[key(r)] ?? r.tracked;
</script>

<PageHeader title="Add to library" onback={() => history.back()} />

<main>
	<div class="field">
		<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
			<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" stroke-linecap="round" />
		</svg>
		<input
			bind:this={input}
			bind:value={query}
			type="search"
			placeholder="Search shows and movies"
			autocapitalize="off"
			autocorrect="off"
			spellcheck="false"
			enterkeyhint="search"
		/>
		{#if query}
			<button class="clear" onclick={() => (query = '')} aria-label="Clear">×</button>
		{/if}
	</div>

	<div class="chips" role="tablist">
		{#each CHIPS as chip (chip.id)}
			<button role="tab" aria-selected={scope === chip.id} class:on={scope === chip.id} onclick={() => (scope = chip.id)}>
				{chip.label}
			</button>
		{/each}
	</div>

	{#if failed}
		<p class="msg error">{failed}</p>
	{:else if !query.trim()}
		{#if data.trending.length}
			<h2 class="eyebrow">Trending now</h2>
			<ul class="grid">
				{#each data.trending as r (r.mediaId)}
					<li>
						<button onclick={() => r.mediaType === 'tv' && goto(`/show/${r.source}/${r.mediaId}`)}>
							<Poster src={r.poster} width={104} height={156} radius={9} />
							<span class="cap">{r.title}</span>
							{#if r.year}<span class="sub tnum">{r.year}</span>{/if}
						</button>
						<span class="gridadd">
							<AddButton
								mediaType={r.mediaType}
								source={r.source}
								mediaId={r.mediaId}
								title={r.title}
								onerror={(m) => (failed = m)}
							/>
						</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="msg">Search Floppy's providers to add something new.</p>
		{/if}
	{:else if searching}
		<p class="msg">Searching…</p>
	{:else if !results.length}
		<p class="msg">Nothing found for “{query.trim()}”.</p>
	{:else}
		<ul class="results">
			{#each results as r (key(r))}
				<li>
					<button class="body" onclick={() => goto(`/show/${r.source}/${r.mediaId}`)} disabled={r.mediaType !== 'tv'}>
						<Poster src={r.poster} width={46} height={69} radius={7} />
						<span class="meta">
							<span class="title">{r.title}</span>
							<span class="sub tnum">
								{r.mediaType === 'tv' ? 'TV' : 'Movie'}{r.year ? ` · ${r.year}` : ''}
							</span>
						</span>
					</button>
					<button
						class="add"
						class:on={isAdded(r)}
						disabled={busy.has(key(r))}
						aria-label={isAdded(r) ? `Remove ${r.title}` : `Add ${r.title}`}
						onclick={() => toggleAdd(r)}
					>
						{#if isAdded(r)}
							<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
						{:else}
							<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		padding: 4px var(--gutter) calc(var(--safe-b) + 32px);
	}

	.field {
		display: flex;
		align-items: center;
		gap: 9px;
		height: var(--tap);
		padding: 0 12px;
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text-dim);
	}
	.field input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 16px; /* 16px keeps iOS from zooming the viewport on focus */
		outline: none;
		-webkit-appearance: none;
		appearance: none;
	}
	.field input::-webkit-search-cancel-button {
		display: none;
	}
	.clear {
		flex: none;
		width: 28px;
		height: 28px;
		font-size: 20px;
		color: var(--text-dim);
	}

	.chips {
		display: flex;
		gap: 6px;
		margin: 10px 0 14px;
		overflow-x: auto;
	}
	.chips button {
		flex: none;
		min-height: 34px;
		padding: 0 13px;
		border-radius: 9px;
		background: var(--surface);
		font-size: 13px;
		font-weight: 600;
		color: var(--text-dim);
	}
	.chips button.on {
		background: var(--surface-raised);
		color: var(--text);
	}

	.msg {
		margin: 40px 0;
		text-align: center;
		font-size: 14px;
		color: var(--text-dim);
	}
	.msg.error {
		color: #ff8a8a;
	}

	.eyebrow {
		margin: 4px 0 10px; font-size: 12.5px; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim);
	}
	.grid {
		display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
		gap: 16px 12px; margin: 0; padding: 0; list-style: none;
	}
	.grid li { position: relative; }
	.grid li > button { width: 100%; text-align: left; }
	.gridadd { position: absolute; right: 5px; top: 128px; }
	.cap {
		display: -webkit-box; margin-top: 6px; font-size: 12.5px; font-weight: 600; line-height: 1.3;
		overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
	}
	.sub { display: block; font-size: 11px; color: var(--text-dim); }

	.results {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.results li {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		border-radius: var(--radius);
		background: var(--surface);
	}
	.body {
		display: grid;
		grid-template-columns: 46px 1fr;
		align-items: center;
		gap: 12px;
		padding: 8px;
		min-width: 0;
		text-align: left;
	}
	.body:disabled {
		cursor: default;
	}
	.meta {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.title {
		font-size: 15px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 12px;
		color: var(--text-dim);
	}

	.add {
		display: grid;
		place-items: center;
		width: var(--tap);
		height: var(--tap);
		margin-right: 6px;
		border-radius: 50%;
		background: var(--surface-raised);
		color: var(--text);
	}
	.add.on {
		background: var(--signal);
		color: #fff;
	}
	.add:disabled {
		opacity: 0.5;
	}
</style>
