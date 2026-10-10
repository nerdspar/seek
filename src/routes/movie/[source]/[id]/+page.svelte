<script lang="ts">
	import NotLinked from '$lib/components/NotLinked.svelte';
	import { notLinkedOf } from '$lib/notLinked';
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import StateChips from '$lib/components/StateChips.svelte';
	import StatusSheet from '$lib/components/StatusSheet.svelte';
	import RatingSheet from '$lib/components/RatingSheet.svelte';
	import ItemMenu from '$lib/components/ItemMenu.svelte';
	import ArrButton from '$lib/components/ArrButton.svelte';
	import ArrAddSheet from '$lib/components/ArrAddSheet.svelte';
	import MovieManageSheet from '$lib/components/MovieManageSheet.svelte';
	import { loadArrStatus, arrManageOn } from '$lib/arr.svelte';
	import { queuePercent } from '$lib/arrClient';
	import { navigating } from '$app/state';
	import type { ArrMovie, ArrQueueItem } from '$lib/server/arr';
	import { formatRuntime } from '$lib/format';
	import { statusLabel, type Tracking } from '$lib/tracking';
	import { trackedOf, setTitle, confirmTitle, revertTitle } from '$lib/status.svelte';
	import { notify } from '$lib/notices.svelte';
	import { touchWatchlist } from '$lib/dirty';
	import { queuedWrite } from '$lib/queue.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	/* The title's name once it loads — handed to queued writes so a change that
	   fails to save later can say which title it was. */
	let titleName = $state<string | undefined>();
	$effect(() => {
		let live = true;
		data.movie.then((t) => live && (titleName = t.title)).catch(() => {});
		return () => {
			live = false;
		};
	});

	let note = $state<string | null>(null);
	let arrRequest = $state<{ mediaType: string; tmdbId: string; title: string } | null>(null);

	/* Radarr download state for this film, for the header manage icon + sheet.
	   Id-matched `arrShown` so navigation never flashes the previous film's state. */
	let arrMovie = $state<ArrMovie | null>(null);
	let arrMovieId = $state<string | null>(null);
	const arrShown = $derived(arrMovieId === data.mediaId ? arrMovie : null);
	let moviePercent = $state<number | null>(null);
	let manageOpen = $state(false);

	async function refreshArr() {
		if (!arrManageOn('movie')) return;
		try {
			const [tRes, qRes] = await Promise.all([
				fetch(`/api/arr/title?mediaType=movie&tmdbId=${encodeURIComponent(data.mediaId)}`),
				fetch('/api/arr/queue')
			]);
			if (tRes.ok) {
				arrMovie = ((await tRes.json()) as { movie: ArrMovie | null }).movie ?? null;
				arrMovieId = data.mediaId;
			}
			if (qRes.ok && arrMovie) {
				const q = ((await qRes.json()) as { radarr: ArrQueueItem[] }).radarr ?? [];
				const item = q.find((i) => i.movieId === arrMovie!.id);
				moviePercent = item ? queuePercent(item) : null;
			}
		} catch {
			/* a down Radarr just means no controls */
		}
	}

	$effect(() => {
		const id = data.mediaId;
		let cancelled = false;
		moviePercent = null;
		(async () => {
			await loadArrStatus();
			if (cancelled || !arrManageOn('movie')) return;
			void id;
			await refreshArr();
		})();
		return () => {
			cancelled = true;
		};
	});
	let statusOpen = $state(false);
	let ratingOpen = $state(false);
	let menuOpen = $state(false);
	let jointEdit = $state<boolean | null>(null);
	let jointBusy = $state(false);

	/* Company applies to films exactly as it does to shows (household/shared.ts
	   keeps a list of each). It is hidden when the feature is switched off in settings. */
	async function toggleJoint(current: boolean, movieTitle: string) {
		if (jointBusy) return;
		const before = jointEdit;
		const next = !current;
		jointBusy = true;
		jointEdit = next;
		try {
			const res = await queuedWrite(`tags:movie:${data.mediaId}`, 'set', '/api/tags', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaType: 'movie',
					source: data.source,
					mediaId: data.mediaId,
					joint: next,
					title: movieTitle
				})
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			touchWatchlist();
		} catch (err) {
			jointEdit = before;
			note = `Couldn't update — ${err instanceof Error ? err.message : err}`;
		} finally {
			jointBusy = false;
		}
	}
	let trackBusy = $state(false);
	let trackEdit = $state<Tracking | null>(null);

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
	/* Coalesced into one rAF per frame — see the show page for the rationale. */
	let measureQueued = false;
	function scheduleMeasure() {
		if (measureQueued) return;
		measureQueued = true;
		requestAnimationFrame(() => {
			measureQueued = false;
			measureHero();
		});
	}

	const year = (iso: string | null) => (iso ? new Date(iso).getFullYear() : null);

	async function patchTracking(base: Tracking, change: { status?: number; score?: number | null }) {
		if (trackBusy) return;
		const before = trackEdit;
		trackBusy = true;
		trackEdit = { ...base, ...change, tracked: true };
		try {
			const res = await queuedWrite(`tracking:movie:${data.mediaId}:${Object.keys(change).join('-')}`, 'set', '/api/tracking', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaType: 'movie',
					source: data.source,
					mediaId: data.mediaId,
					...change
				})
			}, titleName);
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			touchWatchlist();
		} catch (err) {
			trackEdit = before;
			note = `Couldn't save — ${err instanceof Error ? err.message : err}`;
		} finally {
			trackBusy = false;
		}
	}

	async function toggleTracked(current: boolean) {
		if (trackBusy) return;
		const next = !current;
		if (!next && !confirm('Remove this from your library? Any watched progress goes with it.')) return;
		if (!next) menuOpen = false;

		trackBusy = true;
		setTitle(data.source, data.mediaId, { tracked: next });
		try {
			const res = await queuedWrite(`library:movie:${data.mediaId}`, next ? 'add' : 'remove', '/api/library', {
				method: next ? 'POST' : 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaType: 'movie', source: data.source, mediaId: data.mediaId })
			}, titleName);
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			confirmTitle(data.source, data.mediaId, { tracked: next });
			touchWatchlist();
			void notify(next ? 'Added to your library' : 'Removed from your library');
		} catch (err) {
			revertTitle(data.source, data.mediaId, ['tracked']);
			note = `Couldn't ${next ? 'add' : 'remove'} — ${err instanceof Error ? err.message : err}`;
		} finally {
			trackBusy = false;
		}
		trackEdit = null;
	}

	/* Recording a play is no longer done from here: setting Completed in the
	   status picker records one. Taking a play back has no such
	   path — moving off Completed leaves it behind — so this stays as the one
	   control that can, reachable from the menu. */
	let watchBusy = $state(false);
	let watchedEdit = $state<boolean | null>(null);

	async function clearWatchHistory() {
		if (watchBusy) return;
		if (!confirm('Clear this film from your history? The status stays as it is.')) return;
		menuOpen = false;

		watchBusy = true;
		const before = watchedEdit;
		watchedEdit = false;
		try {
			const res = await queuedWrite(`watch:movie:${data.mediaId}`, 'remove', '/api/watch', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaType: 'movie',
					source: data.source,
					mediaId: data.mediaId,
					title: ''
				})
			}, titleName);
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			touchWatchlist();
			void notify('Cleared');
		} catch (err) {
			watchedEdit = before;
			note = `Couldn't update — ${err instanceof Error ? err.message : err}`;
		} finally {
			watchBusy = false;
		}
	}
</script>

<svelte:window onscroll={scheduleMeasure} onresize={scheduleMeasure} />

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
	{#snippet headerActions()}
		<div class="hactions">
			{#if arrShown && arrManageOn('movie') && !navigating.to}
				<button
					class="manage"
					class:monitored={arrShown.monitored}
					aria-label={arrShown.monitored ? 'Monitored in Radarr — manage downloads' : 'Not monitored — manage downloads'}
					onclick={() => (manageOpen = true)}
				>
					<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="6" rx="1.6" /><rect x="3" y="13.5" width="18" height="6" rx="1.6" /><path d="M6.5 7.5h.01M6.5 16.5h.01" /></svg>
				</button>
			{/if}
			{#if trackedOf(data.source, data.mediaId, movie.tracked)}
				<button class="menu" aria-label="More" onclick={() => (menuOpen = true)}>
					<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
				</button>
			{/if}
		</div>
	{/snippet}

	<PageHeader
		title={movie.title}
		titleHidden={heroVisible}
		action={headerActions}
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
			{@const tracked = trackedOf(data.source, data.mediaId, movie.tracked)}
			{@const watched = watchedEdit ?? movie.watched}

			{#if tracked}
				{#await data.joint then serverJoint}
					{@const joint = jointEdit ?? serverJoint}
					<!-- main has no side padding here, so the row carries the gutter. -->
					<div class="chiprow">
						<StateChips
							tracking={t}
							{joint}
							showCompany={data.companyTracking}
							busy={trackBusy || watchBusy || jointBusy}
							onmain={() => (statusOpen = true)}
							onrating={() => (ratingOpen = true)}
							oncompany={() => toggleJoint(joint, movie.title)}
						/>
					</div>
				{/await}
			{:else}
				<button class="add" disabled={trackBusy} onclick={() => toggleTracked(false)}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
					<span>Add to library</span>
				</button>
			{/if}

			{#if !arrShown}
				<div class="arr-request">
					<ArrButton mediaType="movie" tmdbId={data.mediaId} title={movie.title} onadd={(i) => (arrRequest = i)} />
				</div>
			{/if}


			{#if statusOpen && tracked}
				<StatusSheet
					title={movie.title}
					status={t.status}
					busy={trackBusy}
					onpick={(status) => patchTracking(t, { status })}
					onclose={() => (statusOpen = false)}
				/>
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
					busy={trackBusy || watchBusy}
					onclearhistory={watched ? clearWatchHistory : undefined}
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
	{@const missing = notLinkedOf(err)}
	<PageHeader title="" onback={() => history.back()} />
	<main>
		{#if missing}
			<NotLinked service={missing} />
		{:else}
			<div class="failed">
				<h2>Couldn't load that film</h2>
				<p>{err.message}</p>
			</div>
		{/if}
	</main>
{/await}

{#if note}
	<div class="note" role="status">
		<span>{note}</span>
		<button onclick={() => (note = null)} aria-label="Dismiss">×</button>
	</div>
{/if}

{#if arrRequest}
	<ArrAddSheet item={arrRequest} onclose={() => (arrRequest = null)} />
{/if}

{#if manageOpen && arrShown}
	<MovieManageSheet
		tmdbId={data.mediaId}
		title={arrShown.title}
		movie={arrShown}
		percent={moviePercent}
		onchange={refreshArr}
		onclose={() => (manageOpen = false)}
	/>
{/if}

<style>
	main { padding: 4px 0 calc(var(--safe-b) + 32px); }
	/* Sonarr/Radarr add pill under the tracking controls; matches their width.
	   The movie page carries its own side gutter on the chip row. */
	.arr-request { margin: -6px var(--gutter) 16px; }
	.arr-request :global(button) { width: 100%; }
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

	.hactions { display: flex; align-items: center; gap: 2px; }
	.menu, .manage {
		display: grid; place-items: center;
		width: var(--tap); height: var(--tap);
		border-radius: 50%; color: var(--text-dim);
	}
	.manage.monitored { color: var(--signal-solid); }

	/* main has no side padding, so the button carries the gutter itself; a
	   block-level flex fills the width between those margins. */
	.add {
		display: flex; align-items: center; justify-content: center; gap: 9px;
		/* A <button> shrinks to its text on width:auto, so fill the row explicitly
		   (main has no side padding — the gutter lives in the margins). */
		width: calc(100% - 2 * var(--gutter));
		margin: 0 var(--gutter) 16px;
		min-height: var(--tap);
		border-radius: var(--radius);
		background: var(--signal);
		font-size: 15px; font-weight: 600; color: #fff;
	}
	.add:disabled { opacity: 0.6; }

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
