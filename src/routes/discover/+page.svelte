<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import Poster from '$lib/components/Poster.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import AddButton from '$lib/components/AddButton.svelte';
	import ArrButton from '$lib/components/ArrButton.svelte';
	import ArrAddSheet from '$lib/components/ArrAddSheet.svelte';
	import { loadArrStatus } from '$lib/arr.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import type { TmdbResult } from '$lib/types';
	import type { Snapshot } from '@sveltejs/kit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let note = $state<string | null>(null);

	/** The title whose Sonarr/Radarr add sheet is open, if any. One sheet for the
	 *  whole page — a dialog cannot live inside a tile's own <button>. */
	let arrRequest = $state<{ mediaType: string; tmdbId: string; title: string } | null>(null);
	onMount(() => void loadArrStatus());

	/* ── Mood and theme search (§6.2) ──────────────────────────────────────
	   The distinguishing feature: "I want a heist show", not a trending grid.
	   Chips carry no keyword ids — the server owns those — so the client cannot
	   construct TMDB queries of its own. */
	/* ── Browse by streaming service (§6.3) ────────────────────────────────
	   "What's new on Netflix" is a different question from a mood, so it gets
	   its own row and replaces the shelves the same way a mood search does. */
	type Platform = { id: number; name: string; logo: string | null };
	let platform = $state<Platform | null>(null);
	let platformRows = $state<{ mode: string; items: TmdbResult[] }[] | null>(null);
	let platformBusy = $state(false);

	async function pickPlatform(p: Platform) {
		if (platform?.id === p.id) {
			platform = null;
			platformRows = null;
			return;
		}
		platform = p;
		platformRows = null;
		clearMood();
		platformBusy = true;
		try {
			const res = await fetch(`/api/platform?id=${p.id}&type=${data.mediaType}`);
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			platformRows = (await res.json()).rows;
		} catch (err) {
			note = err instanceof Error ? err.message : String(err);
			platform = null;
		} finally {
			platformBusy = false;
		}
	}

	const MODE_LABEL: Record<string, string> = { trending: 'Trending on', new: 'New on' };

	type Section = { kind: string; title: string; why: string | null; items: TmdbResult[] };

	let mood = $state<string | null>(null);
	let freeText = $state('');

	/* Run a query handed over in the URL, and re-run it when the URL changes so
	   arriving from a second cast member actually searches again rather than
	   leaving the first result on screen. Seeding freeText here rather than in
	   its initialiser keeps a single path for both first load and navigation. */
	let ranQuery = $state<string | null>(null);
	$effect(() => {
		const q = (data.query ?? '').trim();
		if (!q || q === ranQuery) return;
		ranQuery = q;
		freeText = q;
		runSearch(q);
	});
	let moodResults = $state<TmdbResult[] | null>(null);
	let sections = $state<Section[] | null>(null);
	let moodBusy = $state(false);

	/* How a mood grid (Heist, True crime…) is ordered. Sticky across presets so
	   "show me the newest" keeps meaning that as you hop between chips. */
	type Sort = 'recommended' | 'newest' | 'top';
	const SORT_OPTIONS = [
		{ id: 'recommended', label: 'Recommended' },
		{ id: 'newest', label: 'Newest' },
		{ id: 'top', label: 'Highest rated' }
	] as const;
	let sort = $state<Sort>('recommended');

	function setSort(next: Sort) {
		if (next === sort) return;
		sort = next;
		if (mood) runMood(new URLSearchParams({ preset: mood }));
	}

	/* Discover's filter — a mood chip, a typed search, or a platform — lives only
	   in component state, so opening a show and pressing back used to drop it and
	   dump you back on the default shelves. A snapshot restores the whole
	   selection, and its already-fetched results, on back/forward — which is what
	   SvelteKit snapshots are for. */
	type Captured = {
		mood: string | null;
		freeText: string;
		ranQuery: string | null;
		sort: Sort;
		platform: Platform | null;
		platformRows: { mode: string; items: TmdbResult[] }[] | null;
		moodResults: TmdbResult[] | null;
		sections: Section[] | null;
		/** How far each horizontal rail was scrolled, keyed by rail id. */
		rails: Record<string, number>;
	};

	/** SvelteKit restores window scroll on back, but never a rail's own horizontal
	 *  scroll — so a row you'd scrolled through snapped back to the start.
	 *  `railScroll` holds each rail's offset (kept current by the action below and
	 *  carried across the back navigation by the snapshot). The action reapplies it
	 *  the moment the rail mounts, which is the reliable hook: the feed streams in,
	 *  so the row does not exist yet when `restore()` runs, and re-rendering the
	 *  row simply re-runs the action on the new element. */
	// Never reassigned — every action closure and the snapshot share this one
	// object, so a restore that mutates it is seen no matter the timing.
	const railScroll: Record<string, number> = {};

	function keepRailScroll(node: HTMLElement, key: string) {
		let k = key;
		const save = () => {
			railScroll[k] = node.scrollLeft;
		};
		// Retry briefly: the row streams in and restore() may land either side of
		// this mount, so re-check the saved offset until it takes (or there is
		// none). Stops as soon as it sticks, to keep out of a user's way.
		let tries = 0;
		const apply = () => {
			const want = railScroll[k];
			if (want && node.scrollWidth > node.clientWidth + 4) {
				node.scrollLeft = want;
				if (Math.abs(node.scrollLeft - want) < 2) return;
			}
			if (tries++ < 40) requestAnimationFrame(apply);
		};
		requestAnimationFrame(apply);
		node.addEventListener('scroll', save, { passive: true });
		return {
			update(next: string) {
				k = next;
			},
			destroy() {
				node.removeEventListener('scroll', save);
			}
		};
	}

	export const snapshot: Snapshot<Captured> = {
		capture: () => ({
			mood,
			freeText,
			ranQuery,
			sort,
			platform,
			platformRows,
			moodResults,
			sections,
			rails: { ...railScroll }
		}),
		restore: (v) => {
			mood = v.mood;
			freeText = v.freeText;
			ranQuery = v.ranQuery;
			sort = v.sort;
			platform = v.platform;
			platformRows = v.platformRows;
			moodResults = v.moodResults;
			sections = v.sections;
			// Mutate the shared object in place (see railScroll) so the rails'
			// actions read the restored offsets whenever they mount.
			for (const key of Object.keys(railScroll)) delete railScroll[key];
			Object.assign(railScroll, v.rails ?? {});
		}
	};

	async function runMood(params: URLSearchParams) {
		moodBusy = true;
		sections = null;
		try {
			params.set('type', data.mediaType);
			params.set('sort', sort);
			const res = await fetch(`/api/mood?${params}`);
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			moodResults = (await res.json()).results;
		} catch (err) {
			note = err instanceof Error ? err.message : String(err);
			moodResults = null;
		} finally {
			moodBusy = false;
		}
	}

	/** The search box answers whatever the query happens to mean. */
	async function runSearch(q: string) {
		moodBusy = true;
		moodResults = null;
		sections = null;
		try {
			const res = await fetch(`/api/explore?q=${encodeURIComponent(q)}&type=${data.mediaType}`);
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			sections = (await res.json()).sections;
		} catch (err) {
			note = err instanceof Error ? err.message : String(err);
		} finally {
			moodBusy = false;
		}
	}

	function pickPreset(label: string) {
		platform = null;
		platformRows = null;
		if (mood === label) {
			mood = null;
			moodResults = null;
			return;
		}
		mood = label;
		freeText = '';
		runMood(new URLSearchParams({ preset: label }));
	}

	function submitFreeText(e: SubmitEvent) {
		e.preventDefault();
		const q = freeText.trim();
		if (!q) return;
		submitFreeTextClearsPlatform();
		mood = null;
		runSearch(q);
	}

	function clearMood() {
		mood = null;
		freeText = '';
		moodResults = null;
		sections = null;
	}

	function submitFreeTextClearsPlatform() {
		platform = null;
		platformRows = null;
	}

	const open = (mediaType: string, source: string, mediaId: string) => {
		// Films have their own page now; this used to silently do nothing for them.
		goto(`/${mediaType === 'movie' ? 'movie' : 'show'}/${source}/${mediaId}`);
	};
</script>

<div class="app">
	<header>
		<h1>Discover</h1>
		<div class="segments" role="tablist">
			{#each [{ id: 'tv', label: 'TV' }, { id: 'movie', label: 'Movies' }] as seg (seg.id)}
				<button
					role="tab"
					aria-selected={data.mediaType === seg.id}
					class:on={data.mediaType === seg.id}
					onclick={() => { clearMood(); goto(`/discover?type=${seg.id}`, { noScroll: true }); }}
				>{seg.label}</button>
			{/each}
		</div>
	</header>

<!-- Every slow path shows the same breathing shelves rather than a line of text,
     so a tap always produces something that reads as work in progress. -->
{#snippet skeletonShelves(count: number)}
	{#each Array(count) as _, g (g)}
		<section class="shelf">
			<div class="skhead"><Skeleton width="46%" height="16px" /><Skeleton width="66%" height="12px" /></div>
			<ul class="rail">
				{#each Array(4) as _, i (i)}
					<li><Skeleton height="165px" radius={10} /><Skeleton height="12px" /></li>
				{/each}
			</ul>
		</section>
	{/each}
{/snippet}

	<main>
		{#if data.moodAvailable}
			<section class="mood">
				<form onsubmit={submitFreeText}>
					<input
						bind:value={freeText}
						type="search"
						placeholder="Actor, title, genre, mood, service…"
						autocapitalize="off"
						enterkeyhint="search"
					/>
				</form>
				<div class="chips">
					{#each data.presets as preset (preset)}
						<button class:on={mood === preset} onclick={() => pickPreset(preset)}>{preset}</button>
					{/each}
				</div>
			</section>
		{/if}

		{#await data.platforms then platforms}
			{#if platforms.length}
				<section class="platforms">
					<div class="chips">
						{#each platforms as p (p.id)}
							<button class="platform" class:on={platform?.id === p.id} onclick={() => pickPlatform(p)}>
								{#if p.logo}<img src={p.logo} alt="" />{/if}
								{p.name}
							</button>
						{/each}
					</div>
				</section>
			{/if}
		{/await}

		{#if platformBusy}
			{@render skeletonShelves(2)}
		{:else if platformRows}
			<div class="moodhead">
				<h2>{platform?.name}</h2>
				<button class="clear" onclick={() => { platform = null; platformRows = null; }}>Clear</button>
			</div>
			{#each platformRows.filter((r) => r.items.length) as row (row.mode)}
				<section class="shelf">
					<h2>{MODE_LABEL[row.mode] ?? row.mode} {platform?.name}</h2>
					<ul class="rail" use:keepRailScroll={'pf:' + row.mode}>
						{#each row.items as item (item.mediaId)}
							<li>
								<button class="tile" onclick={() => open(item.mediaType, item.source, item.mediaId)}>
									<Poster src={item.poster} width={110} height={165} radius={10} />
									<span class="add"><AddButton mediaType={item.mediaType} source={item.source} mediaId={item.mediaId} title={item.title} onerror={(m) => (note = m)} /></span>
									<span class="arradd"><ArrButton mediaType={item.mediaType} tmdbId={item.mediaId} title={item.title} onadd={(i) => (arrRequest = i)} compact size={30} /></span>
								</button>
								<span class="cap">{item.title}</span>
								<span class="sub tnum">{[item.year, item.rating ? `★ ${item.rating}` : null].filter(Boolean).join(' · ')}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
			{#if !platformRows.some((r) => r.items.length)}
				<p class="msg">Nothing found on {platform?.name}.</p>
			{/if}
		{:else if moodBusy}
			{@render skeletonShelves(2)}
		{:else if sections}
			<div class="moodhead">
				<h2>“{freeText.trim()}”</h2>
				<button class="clear" onclick={clearMood}>Clear</button>
			</div>
			{#if !sections.length}
				<p class="msg">Nothing matched that — try an actor, a title, a genre or a service.</p>
			{:else}
				{#each sections as section (section.kind + section.title)}
					<section class="shelf">
						<h2>{section.title}</h2>
						{#if section.why}<p class="why">{section.why}</p>{/if}
						<ul class="rail" use:keepRailScroll={'sec:' + section.kind + ':' + section.title}>
							{#each section.items as item (item.mediaId)}
								<li>
									<button class="tile" onclick={() => open(item.mediaType, item.source, item.mediaId)}>
										<Poster src={item.poster} width={110} height={165} radius={10} />
										<span class="add"><AddButton mediaType={item.mediaType} source={item.source} mediaId={item.mediaId} title={item.title} added={item.tracked ?? false} onerror={(m) => (note = m)} /></span>
										<span class="arradd"><ArrButton mediaType={item.mediaType} tmdbId={item.mediaId} title={item.title} onadd={(i) => (arrRequest = i)} compact size={30} /></span>
									</button>
									<span class="cap">{item.title}</span>
									<span class="sub tnum">{[item.year, item.rating ? `★ ${item.rating}` : null].filter(Boolean).join(' · ')}</span>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
			{/if}
		{:else if moodResults}
			<div class="moodhead">
				<h2>{mood ?? `“${freeText.trim()}”`}</h2>
				<button class="clear" onclick={clearMood}>Clear</button>
			</div>
			{#if mood && (moodResults.length || moodBusy)}
				<div class="sortrow" role="tablist" aria-label="Sort">
					{#each SORT_OPTIONS as opt (opt.id)}
						<button role="tab" aria-selected={sort === opt.id} class="sortchip" class:on={sort === opt.id} disabled={moodBusy} onclick={() => setSort(opt.id)}>{opt.label}</button>
					{/each}
				</div>
			{/if}
			{#if !moodResults.length}
				<p class="msg">{moodBusy ? '' : 'Nothing matched that. Try a different word.'}</p>
			{:else}
				<ul class="grid">
					{#each moodResults as r (r.mediaId)}
						<li>
							<button class="tile" onclick={() => open(r.mediaType, r.source, r.mediaId)}>
								<Poster src={r.poster} width={110} height={165} radius={10} />
								<span class="add"><AddButton mediaType={r.mediaType} source={r.source} mediaId={r.mediaId} title={r.title} onerror={(m) => (note = m)} /></span>
								<span class="arradd"><ArrButton mediaType={r.mediaType} tmdbId={r.mediaId} title={r.title} onadd={(i) => (arrRequest = i)} compact size={30} /></span>
							</button>
							<span class="cap">{r.title}</span>
							<span class="sub tnum">{[r.year, r.rating ? `★ ${r.rating}` : null].filter(Boolean).join(' · ')}</span>
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			{#await data.rows}
				{@render skeletonShelves(3)}
			{:then rows}
				{#if !rows.length}
					<div class="empty"><h2>Nothing to suggest yet</h2><p>Floppy builds these rows from your history.</p></div>
				{:else}
				{#each rows as row (row.key)}
				<section class="shelf">
					<h2>{row.title}</h2>
					{#if row.why}<p class="why">{row.why}</p>{/if}
					<ul class="rail" use:keepRailScroll={'row:' + row.key}>
						{#each row.items as item (item.mediaId)}
							<li>
								<button class="tile" onclick={() => open(item.mediaType, item.source, item.mediaId)}>
									<Poster src={item.poster} width={110} height={165} radius={10} />
									<span class="add"><AddButton mediaType={item.mediaType} source={item.source} mediaId={item.mediaId} title={item.title} added={item.tracked ?? false} onerror={(m) => (note = m)} /></span>
									<span class="arradd"><ArrButton mediaType={item.mediaType} tmdbId={item.mediaId} title={item.title} onadd={(i) => (arrRequest = i)} compact size={30} /></span>
								</button>
								<span class="cap">{item.title}</span>
								<span class="sub tnum">{[item.year, item.rating ? `★ ${item.rating}` : null].filter(Boolean).join(' · ')}</span>
							</li>
						{/each}
					</ul>
				</section>
				{/each}
				{/if}
			{:catch err}
				<div class="empty"><h2>Can't load Discover</h2><p>{err.message}</p></div>
			{/await}
		{/if}
	</main>

	<TabBar current="discover" onunbuilt={(l) => (note = `${l} — not built yet (build order §13).`)} />

	{#if note}
		<div class="note" role="status">
			<span>{note}</span>
			<button onclick={() => (note = null)} aria-label="Dismiss">×</button>
		</div>
	{/if}

	{#if arrRequest}
		<ArrAddSheet item={arrRequest} onclose={() => (arrRequest = null)} />
	{/if}
</div>

<style>
	.app { min-height: 100dvh; padding-top: var(--header-top); }
	header { padding: 10px var(--gutter) 4px; }
	h1 { margin: 0 0 10px; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }

	.segments { display: inline-flex; gap: 2px; padding: 3px; border-radius: 11px; background: var(--surface); }
	.segments button {
		min-height: 32px; padding: 0 18px; border-radius: 9px;
		font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.segments button.on { background: var(--surface-raised); color: var(--text); }

	main { padding: 6px 0 calc(var(--tabbar-h) + var(--safe-b) + 32px); }

	.platforms { margin-bottom: 14px; }
	.platform {
		display: flex; align-items: center; gap: 7px;
		flex: none; min-height: 38px; padding: 0 13px 0 5px; border-radius: 10px;
		background: var(--surface); font-size: 13px; font-weight: 600; color: var(--text);
	}
	.platform img { width: 26px; height: 26px; border-radius: 6px; object-fit: cover; }
	.platform.on { background: var(--signal); color: #fff; }

	/* The gutter belongs on the children, not here: this page is full-bleed
	   (main has no horizontal padding) so that scrolling rows can run past the
	   screen edge. Insetting the section would clip the chips short of it. */
	.mood { margin-bottom: 18px; }
	.mood form { padding: 0 var(--gutter); }
	.mood input {
		width: 100%; height: var(--tap); padding: 0 14px;
		border: none; border-radius: var(--radius);
		background: var(--surface); color: var(--text);
		font: inherit; font-size: 16px; outline: none;
		-webkit-appearance: none; appearance: none;
	}
	.mood input::-webkit-search-cancel-button { display: none; }

	/* Padding inside the scroller, never margin around it — chips then sit level
	   with the headings at rest but still scroll to the screen edge, matching
	   .rail and the platform row. */
	.chips { display: flex; gap: 6px; margin-top: 10px; overflow-x: auto; padding: 0 var(--gutter) 2px; }
	.chips button {
		flex: none; min-height: 34px; padding: 0 13px; border-radius: 9px;
		background: var(--surface); font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.chips button.on { background: var(--signal); color: #fff; }

	.moodhead {
		display: flex; align-items: baseline; justify-content: space-between;
		gap: 12px; padding: 0 var(--gutter); margin-bottom: 10px;
	}
	.moodhead h2 { margin: 0; font-size: 17px; font-weight: 600; }
	.clear { font-size: 13px; font-weight: 600; color: var(--signal-solid); }
	.sortrow { display: flex; gap: 6px; margin: 4px 0 2px; overflow-x: auto; }
	.sortchip {
		flex: none;
		min-height: 30px;
		padding: 0 12px;
		border-radius: 9px;
		background: var(--surface);
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text-dim);
	}
	.sortchip.on { background: var(--surface-raised); color: var(--text); }
	.sortchip:disabled { opacity: 0.6; }

	.shelf { margin-bottom: 26px; }
	.skhead { display: flex; flex-direction: column; gap: 6px; padding: 0 var(--gutter); }
	.rail li :global(.sk + .sk) { margin-top: 7px; }
	.shelf h2 { margin: 0 var(--gutter) 2px; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
	.why { margin: 0 var(--gutter) 8px; font-size: 12.5px; color: var(--text-dim); }

	.rail, .grid { margin: 8px 0 0; padding: 0; list-style: none; }
	.rail {
		display: flex; gap: 12px; overflow-x: auto;
		padding: 0 var(--gutter) 4px;
		scroll-snap-type: x proximity;
		/* Without this the snap engine aligns the first tile to the container
		   edge and scrolls the gutter away, so the shelf starts flush left while
		   its heading is indented. */
		scroll-padding-left: var(--gutter);
	}
	.rail li { flex: none; width: 110px; scroll-snap-align: start; }
	.grid {
		display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
		gap: 16px 12px; padding: 0 var(--gutter);
	}

	.tile { position: relative; display: block; width: 110px; }
	.add { position: absolute; right: 5px; bottom: 5px; }
	.arradd { position: absolute; right: 5px; top: 5px; }

	.cap {
		display: block; margin-top: 6px; font-size: 12.5px; font-weight: 600;
		line-height: 1.3; overflow: hidden; display: -webkit-box;
		-webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
	}
	.sub { display: block; font-size: 11px; color: var(--text-dim); }

	.msg { margin: 40px 0; text-align: center; font-size: 14px; color: var(--text-dim); }
	.empty { margin-top: 20vh; text-align: center; padding: 0 var(--gutter); }
	.empty h2 { margin: 0 0 8px; font-size: 17px; }
	.empty p { margin: 0; font-size: 14px; color: var(--text-dim); }

	.note {
		position: fixed; left: var(--gutter); right: var(--gutter);
		bottom: calc(var(--tabbar-h) + var(--safe-b) + 12px); z-index: 60;
		display: flex; align-items: center; gap: 10px;
		padding: 12px 8px 12px 16px; border-radius: var(--radius);
		background: var(--surface-raised); box-shadow: var(--shadow-lg);
		font-size: 13.5px;
	}
	.note span { flex: 1; }
	.note button { flex: none; width: var(--tap); height: var(--tap); font-size: 22px; color: var(--text-dim); }
</style>
