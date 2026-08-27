<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import StateChips from '$lib/components/StateChips.svelte';
	import RatingSheet from '$lib/components/RatingSheet.svelte';
	import ItemMenu from '$lib/components/ItemMenu.svelte';
	import { formatRuntime } from '$lib/format';
	import { statusLabel, type Tracking } from '$lib/tracking';
	import { notify } from '$lib/notices.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let note = $state<string | null>(null);
	let ratingOpen = $state(false);
	let menuOpen = $state(false);
	let jointEdit = $state<boolean | null>(null);
	let jointBusy = $state(false);

	/* Company is a household tag, so it applies to films exactly as it does to
	   shows — verified against a live instance that Floppy stores and filters it
	   on a movie. It is hidden when the feature is switched off in settings. */
	async function toggleJoint(current: boolean) {
		if (jointBusy) return;
		const before = jointEdit;
		const next = !current;
		jointBusy = true;
		jointEdit = next;
		try {
			const res = await fetch('/api/tags', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaType: 'movie',
					source: data.source,
					mediaId: data.mediaId,
					joint: next
				})
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
		} catch (err) {
			jointEdit = before;
			note = `Couldn't update — ${err instanceof Error ? err.message : err}`;
		} finally {
			jointBusy = false;
		}
	}
	let trackBusy = $state(false);
	let trackEdit = $state<Tracking | null>(null);
	let trackedEdit = $state<boolean | null>(null);

	/* Same handover as the show page: the hero carries the title, so the header
	   holds its own back until that scrolls under it. Measured against the
	   header's real bottom edge, which varies with the status-bar inset. */
	let heroVisible = $state(true);
	function measureHero() {
		const el = document.querySelector('[data-hero-title]');
		if (!el) {
			heroVisible = true;
			return;
		}
		const header = document.querySelector('header');
		const edge = header ? header.getBoundingClientRect().bottom : 0;
		heroVisible = el.getBoundingClientRect().bottom > edge;
	}

	const year = (iso: string | null) => (iso ? new Date(iso).getFullYear() : null);

	async function patchTracking(base: Tracking, change: { status?: number; score?: number | null }) {
		if (trackBusy) return;
		const before = trackEdit;
		trackBusy = true;
		trackEdit = { ...base, ...change, tracked: true };
		try {
			const res = await fetch('/api/tracking', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaType: 'movie',
					source: data.source,
					mediaId: data.mediaId,
					...change
				})
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
		} catch (err) {
			trackEdit = before;
			note = `Couldn't save — ${err instanceof Error ? err.message : err}`;
		} finally {
			trackBusy = false;
		}
	}

	async function toggleTracked(current: boolean) {
		if (trackBusy) return;
		const before = trackedEdit;
		const next = !current;
		if (!next && !confirm('Remove this from your library? Any watched progress goes with it.')) return;
		if (!next) menuOpen = false;

		trackBusy = true;
		trackedEdit = next;
		try {
			const res = await fetch('/api/library', {
				method: next ? 'POST' : 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: 'movie', source: data.source, mediaId: data.mediaId })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			void notify(next ? 'Added to your library' : 'Removed from your library');
		} catch (err) {
			trackedEdit = before;
			note = `Couldn't ${next ? 'add' : 'remove'} — ${err instanceof Error ? err.message : err}`;
		} finally {
			trackBusy = false;
		}
		trackEdit = null;
	}

	/** Mark or unmark the film itself. A movie is one thing, so this is the whole
	 *  of its progress — no seasons, no episode list. */
	let watchBusy = $state(false);
	let watchedEdit = $state<boolean | null>(null);

	async function toggleWatched(current: boolean) {
		if (watchBusy) return;
		const next = !current;
		if (!next && !confirm('Clear this film from your history?')) return;

		watchBusy = true;
		const before = watchedEdit;
		watchedEdit = next;
		try {
			const res = await fetch('/api/watch', {
				method: next ? 'POST' : 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaType: 'movie',
					source: data.source,
					mediaId: data.mediaId,
					title: ''
				})
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			void notify(next ? 'Marked watched' : 'Cleared');
		} catch (err) {
			watchedEdit = before;
			note = `Couldn't update — ${err instanceof Error ? err.message : err}`;
		} finally {
			watchBusy = false;
		}
	}
</script>

<svelte:window onscroll={measureHero} onresize={measureHero} />

{#await data.movie}
	<PageHeader title="" onback={() => history.back()} />
	<main class="loading">
		<section class="hero">
			<Skeleton width="104px" height="156px" radius={10} />
			<div class="facts">
				<Skeleton width="70%" height="24px" />
				<Skeleton width="45%" height="18px" />
				<Skeleton width="60%" height="14px" />
			</div>
		</section>
		<Skeleton height="14px" />
		<Skeleton width="92%" height="14px" />
		<Skeleton width="76%" height="14px" />
	</main>
{:then movie}
	{#snippet menuButton()}
		<button class="menu" aria-label="More" onclick={() => (menuOpen = true)}>
			<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
		</button>
	{/snippet}

	<PageHeader
		title={movie.title}
		titleHidden={heroVisible}
		action={movie.tracked || trackedEdit ? menuButton : undefined}
		onback={() => history.back()}
	/>

	<main>
		<section class="hero">
			<Poster src={movie.poster} width={104} height={156} radius={10} eager />
			<div class="facts">
				<h1 data-hero-title>{movie.title}</h1>
				<p class="chips tnum">
					{#if year(movie.releaseDate)}<span class="chip">{year(movie.releaseDate)}</span>{/if}
					{#if movie.certification}<span class="chip">{movie.certification}</span>{/if}
					{#if movie.score}<span class="chip">★ {movie.score.toFixed(1)}</span>{/if}
					{#if movie.runtime}<span class="chip">{formatRuntime(movie.runtime)}</span>{/if}
				</p>

				{#await data.extras then extras}
					{#if extras.services.length}
						<p class="where">
							{#each extras.services.slice(0, 3) as w (w.name)}
								<span class="badge">
									{#if w.logo}<img src={w.logo} alt="" />{/if}
									{w.name}
								</span>
							{/each}
						</p>
					{/if}
				{/await}

				{#if movie.genres.length}
					<p class="genres">{movie.genres.join(' · ')}</p>
				{/if}
			</div>
		</section>

		{#await data.tracking then serverTracking}
			{@const t = trackEdit ?? serverTracking}
			{@const tracked = trackedEdit ?? movie.tracked}
			{@const watched = watchedEdit ?? movie.progress > 0}

			{#if tracked}
				{#await data.joint then serverJoint}
					{@const joint = jointEdit ?? serverJoint}
					<!-- main has no side padding here, so the row carries the gutter. -->
					<div class="chiprow">
						<StateChips
							mediaType="movie"
							tracking={t}
							{watched}
							{joint}
							showCompany={data.companyTracking}
							busy={trackBusy || watchBusy || jointBusy}
							onmain={() => toggleWatched(watched)}
							onrating={() => (ratingOpen = true)}
							oncompany={() => toggleJoint(joint)}
						/>
					</div>
				{/await}
			{:else}
				<button class="add" disabled={trackBusy} onclick={() => toggleTracked(false)}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
					<span>Add to library</span>
				</button>
			{/if}

			{#if ratingOpen && tracked}
				<RatingSheet
					title={movie.title}
					score={t.score}
					busy={trackBusy}
					onpick={(score) => patchTracking(t, { score })}
					onclose={() => (ratingOpen = false)}
				/>
			{/if}

			{#if menuOpen && tracked}
				<ItemMenu
					title={movie.title}
					sourceUrl={movie.sourceUrl}
					floppyUrl={data.floppyBase && t.floppyPath ? `${data.floppyBase}${t.floppyPath}` : null}
					busy={trackBusy}
					onremove={() => toggleTracked(true)}
					onclose={() => (menuOpen = false)}
				/>
			{/if}
		{/await}

		{#if movie.synopsis}
			<p class="synopsis">{movie.synopsis}</p>
		{/if}

		{#if movie.collection}
			<section>
				<h2>{movie.collection.name}</h2>
				<ul class="rail">
					{#each movie.collection.items as film (film.mediaId)}
						<li>
							<button
								class:current={film.mediaId === movie.mediaId}
								onclick={() => goto(`/movie/${film.source}/${film.mediaId}`)}
							>
								<Poster src={film.poster} width={104} height={156} radius={10} />
								<span class="cap">{film.title}</span>
								{#if film.year}<span class="sub tnum">{film.year}</span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if movie.cast.length}
			<section>
				<h2>Cast</h2>
				<ul class="cast">
					{#each movie.cast as person (person.name + (person.role ?? ''))}
						<li>
							<button onclick={() => goto(`/discover?q=${encodeURIComponent(person.name)}&type=movie`)}>
								<Poster src={person.image} width={78} height={78} radius={39} />
								<span class="pname">{person.name}</span>
								{#if person.role}<span class="prole">{person.role}</span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#await data.extras then extras}
			{#if extras.similar.length}
				<section>
					<h2>More like this</h2>
					<ul class="rail">
						{#each extras.similar as rec (rec.mediaId)}
							<li>
								<button onclick={() => goto(`/movie/${rec.source}/${rec.mediaId}`)}>
									<Poster src={rec.poster} width={104} height={156} radius={10} />
									<span class="cap">{rec.title}</span>
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/await}
	</main>
{:catch err}
	<PageHeader title="" onback={() => history.back()} />
	<main>
		<div class="failed">
			<h2>Couldn't load that film</h2>
			<p>{err.message}</p>
		</div>
	</main>
{/await}

{#if note}
	<div class="note" role="status">
		<span>{note}</span>
		<button onclick={() => (note = null)} aria-label="Dismiss">×</button>
	</div>
{/if}

<style>
	main { padding: 4px 0 calc(var(--safe-b) + 32px); }
	.hero { display: flex; gap: 14px; padding: 0 var(--gutter); margin-bottom: 16px; }
	.facts { flex: 1; min-width: 0; }
	h1 { margin: 0 0 8px; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.15; }

	.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
	.chip {
		padding: 4px 9px; border-radius: 7px;
		background: var(--surface-raised); font-size: 12px; color: var(--text-dim);
	}
	.where { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; }
	.badge {
		display: flex; align-items: center; gap: 6px;
		padding: 4px 9px 4px 4px; border-radius: 7px;
		background: var(--surface-raised); font-size: 12px; font-weight: 600;
	}
	.badge img { width: 18px; height: 18px; border-radius: 4px; }
	.genres { margin: 0; font-size: 13px; color: var(--text-dim); }


	.chiprow { margin: 0 var(--gutter); }

	.menu {
		display: grid; place-items: center;
		width: var(--tap); height: var(--tap);
		border-radius: 50%; color: var(--text-dim);
	}

	.add { justify-content: center; margin-bottom: 16px; background: var(--signal); font-weight: 600; color: #fff; }

	.synopsis { margin: 6px var(--gutter) 22px; font-size: 14.5px; line-height: 1.55; }

	section h2 { margin: 0 var(--gutter) 8px; font-size: 16px; font-weight: 600; }
	.cast, .rail { display: flex; gap: 12px; margin: 0 0 24px; padding: 0 var(--gutter) 4px; list-style: none; overflow-x: auto; }
	.cast li { flex: none; width: 78px; }
	.rail li { flex: none; width: 104px; }
	.pname, .cap { display: block; margin-top: 6px; font-size: 12px; font-weight: 600; line-height: 1.3; }
	.sub { display: block; font-size: 11px; color: var(--text-dim); }
	/* The film you are already on stays in the rail — a franchise reads wrong
	   with a gap in it — but dimmed, so it does not invite a tap to nowhere. */
	.rail button.current { opacity: 0.45; }
	.prole { display: block; font-size: 11px; color: var(--text-dim); }

	.failed { padding: 40px var(--gutter); text-align: center; }
	.failed h2 { margin: 0 0 6px; font-size: 17px; }
	.failed p { margin: 0; font-size: 13.5px; color: var(--text-dim); }

	.note {
		position: fixed; left: var(--gutter); right: var(--gutter);
		bottom: calc(var(--safe-b) + 16px);
		display: flex; align-items: center; justify-content: space-between; gap: 12px;
		padding: 12px 14px; border-radius: var(--radius);
		background: var(--surface-raised); box-shadow: var(--shadow-lg);
		font-size: 13.5px;
	}
</style>
