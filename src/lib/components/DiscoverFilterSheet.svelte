<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { ERAS, eraId, emptyFilter, filterQuery, type DiscoverFilter, type DiscoverSort, type Token } from '$lib/discoverFilter';

	/**
	 * Build a Discover filter: genres, tags and people (typed, autocompleted),
	 * services, era and sort — all visible at once, no horizontal scroller. The
	 * button shows a live result count so you see the combination narrowing.
	 */
	let { filter, onapply, onclose }: { filter: DiscoverFilter; onapply: (f: DiscoverFilter) => void; onclose: () => void } = $props();

	// Seed once from the incoming filter (the sheet remounts each open), then own it.
	let draft = $state<DiscoverFilter>(emptyFilter('tv'));
	let seeded = false;
	$effect(() => {
		if (seeded) return;
		seeded = true;
		draft = { ...filter, genres: [...filter.genres], keywords: [...filter.keywords], people: [...filter.people], providers: [...filter.providers] };
	});

	let genres = $state<Token[]>([]);
	let services = $state<Token[]>([]);
	$effect(() => {
		fetch(`/api/discover/facets?type=${draft.type}`)
			.then((r) => (r.ok ? r.json() : { genres: [], services: [] }))
			.then((b) => {
				genres = b.genres ?? [];
				services = b.services ?? [];
			})
			.catch(() => {});
	});

	const SORTS: { id: DiscoverSort; label: string }[] = [
		{ id: 'recommended', label: 'Recommended' },
		{ id: 'top', label: 'Top rated' },
		{ id: 'newest', label: 'Newest' }
	];

	const toggle = (list: number[], id: number) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
	function setType(t: 'tv' | 'movie') {
		if (t === draft.type) return;
		// Genres and services are per-type; a decade/sort/tag/person carries over.
		draft = { ...draft, type: t, genres: [], providers: [] };
	}
	function setEra(id: string) {
		const e = ERAS.find((x) => x.id === id);
		if (!e) return;
		if (eraId(draft) === id) draft = { ...draft, yearGte: null, yearLte: null };
		else draft = { ...draft, yearGte: e.gte, yearLte: e.lte };
	}

	/* Tag & people autocomplete. */
	let term = $state('');
	let sugg = $state<{ keywords: Token[]; people: (Token & { known_for: string | null })[] }>({ keywords: [], people: [] });
	let suggSeq = 0;
	$effect(() => {
		const q = term.trim();
		if (!q) {
			sugg = { keywords: [], people: [] };
			return;
		}
		const mine = ++suggSeq;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/discover/suggest?q=${encodeURIComponent(q)}`);
				if (!res.ok) return;
				const b = await res.json();
				if (mine === suggSeq) sugg = { keywords: b.keywords ?? [], people: b.people ?? [] };
			} catch {
				/* no suggestions is fine */
			}
		}, 250);
		return () => clearTimeout(timer);
	});
	function addKeyword(t: Token) {
		if (!draft.keywords.some((k) => k.id === t.id)) draft = { ...draft, keywords: [...draft.keywords, t] };
		term = '';
		sugg = { keywords: [], people: [] };
	}
	function addPerson(t: Token) {
		if (!draft.people.some((p) => p.id === t.id)) draft = { ...draft, people: [...draft.people, t] };
		term = '';
		sugg = { keywords: [], people: [] };
	}

	/* Live count for the button. */
	let count = $state<number | null>(null);
	let countSeq = 0;
	$effect(() => {
		const query = filterQuery(draft);
		const mine = ++countSeq;
		count = null;
		const timer = setTimeout(async () => {
			try {
				const res = await fetch(`/api/discover/filter?${query}&page=1`);
				if (!res.ok) return;
				const b = await res.json();
				if (mine === countSeq) count = b.total ?? 0;
			} catch {
				/* leave the count blank */
			}
		}, 350);
		return () => clearTimeout(timer);
	});

	function clear() {
		draft = emptyFilter(draft.type);
	}
	const countLabel = $derived(count === null ? 'Show results' : `Show ${count.toLocaleString()} result${count === 1 ? '' : 's'}`);
</script>

<Sheet label="Filter Discover" {onclose} scrollable>
	<div class="pad">
		<div class="seg type">
			<button class:on={draft.type === 'tv'} onclick={() => setType('tv')}>TV Shows</button>
			<button class:on={draft.type === 'movie'} onclick={() => setType('movie')}>Movies</button>
		</div>

		<h3>Tags &amp; people</h3>
		<input class="tagin" bind:value={term} placeholder="Type a tag or a name — “heist”, “Nick Offerman”" autocapitalize="off" autocorrect="off" spellcheck="false" />
		{#if draft.keywords.length || draft.people.length}
			<div class="wrap tokens">
				{#each draft.people as t (t.id)}
					<button class="tok" onclick={() => (draft = { ...draft, people: draft.people.filter((p) => p.id !== t.id) })}>{t.name} ✕</button>
				{/each}
				{#each draft.keywords as t (t.id)}
					<button class="tok" onclick={() => (draft = { ...draft, keywords: draft.keywords.filter((k) => k.id !== t.id) })}>{t.name} ✕</button>
				{/each}
			</div>
		{/if}
		{#if sugg.people.length || sugg.keywords.length}
			<div class="wrap sugg">
				{#each sugg.people as p (p.id)}
					<button class="chip" onclick={() => addPerson(p)}>{p.name}{#if p.known_for}<span class="kf"> · {p.known_for}</span>{/if}</button>
				{/each}
				{#each sugg.keywords as k (k.id)}
					<button class="chip" onclick={() => addKeyword(k)}>{k.name}</button>
				{/each}
			</div>
		{/if}

		{#if genres.length}
			<h3>Genre</h3>
			<div class="wrap">
				{#each genres as g (g.id)}
					<button class="chip" class:on={draft.genres.includes(g.id)} onclick={() => (draft = { ...draft, genres: toggle(draft.genres, g.id) })}>{g.name}</button>
				{/each}
			</div>
		{/if}

		{#if services.length}
			<h3>Where</h3>
			<div class="wrap">
				{#each services as s (s.id)}
					<button class="chip" class:on={draft.providers.includes(s.id)} onclick={() => (draft = { ...draft, providers: toggle(draft.providers, s.id) })}>{s.name}</button>
				{/each}
			</div>
		{/if}

		<h3>Era</h3>
		<div class="wrap">
			{#each ERAS as e (e.id)}
				<button class="chip" class:on={eraId(draft) === e.id} onclick={() => setEra(e.id)}>{e.label}</button>
			{/each}
		</div>

		<h3>Sort</h3>
		<div class="seg">
			{#each SORTS as s (s.id)}
				<button class:on={draft.sort === s.id} onclick={() => (draft = { ...draft, sort: s.id })}>{s.label}</button>
			{/each}
		</div>

		<div class="foot">
			<button class="ghost" onclick={clear}>Clear</button>
			<button class="primary" onclick={() => onapply(draft)}>{countLabel}</button>
		</div>
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter) 10px; }
	h3 { margin: 16px 2px 7px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-dim); }
	.seg { display: flex; gap: 3px; padding: 3px; border-radius: 10px; background: var(--surface); }
	.seg.type { margin-top: 2px; }
	.seg button { flex: 1; min-height: 34px; border-radius: 8px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
	.seg button.on { background: var(--surface-raised); color: var(--text); }
	.tagin {
		width: 100%; height: var(--tap); padding: 0 13px; border-radius: var(--radius);
		background: var(--surface); color: var(--text); font: inherit; font-size: 16px;
		border: none; outline: none; -webkit-appearance: none; appearance: none;
	}
	.wrap { display: flex; flex-wrap: wrap; gap: 6px; }
	.tokens { margin-top: 8px; }
	.sugg { margin-top: 8px; }
	.chip {
		min-height: 34px; padding: 0 12px; border-radius: 9px;
		background: var(--surface); font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.chip.on { background: var(--signal); color: #fff; }
	.kf { color: var(--text-dim); font-weight: 400; }
	.tok {
		min-height: 34px; padding: 0 12px; border-radius: 9px;
		background: var(--signal); color: #fff; font-size: 13px; font-weight: 600;
	}
	.foot { display: flex; gap: 8px; margin-top: 18px; }
	.foot button { flex: 1; min-height: 46px; border-radius: 12px; font-size: 14px; font-weight: 600; }
	.foot .ghost { flex: 0 0 90px; background: var(--surface); color: var(--text); }
	.foot .primary { background: var(--signal); color: #fff; }
</style>
