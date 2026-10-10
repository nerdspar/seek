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
	import SeriesManageSheet from '$lib/components/SeriesManageSheet.svelte';
	import { loadArrStatus, arrManageOn } from '$lib/arr.svelte';
	import { navigating } from '$app/state';
	import type { ArrSeries } from '$lib/server/arr';
	import { statusLabel, type Tracking } from '$lib/tracking';
	import { trackedOf, setTitle, confirmTitle, revertTitle } from '$lib/status.svelte';
	import { formatRuntime } from '$lib/format';
	import { haptic } from '$lib/haptics';
	import { notify } from '$lib/notices.svelte';
	import { confirmShowAdded } from '$lib/together';
	import { touchWatchlist } from '$lib/dirty';
	import { queuedWrite } from '$lib/queue.svelte';
	import type { SeasonSummary, ShowDetail } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	/* The title's name once it loads — handed to queued writes so a change that
	   fails to save later can say which title it was. */
	let titleName = $state<string | undefined>();
	$effect(() => {
		let live = true;
		data.show.then((t) => live && (titleName = t.title)).catch(() => {});
		return () => {
			live = false;
		};
	});

	let arrRequest = $state<{ mediaType: string; tmdbId: string; title: string } | null>(null);

	/* Sonarr download state for this show (series settings + per-season file
	   counts), loaded only when the management layer is switched on. Refreshed
	   after an edit/search so counts and the monitored summary stay current. */
	let arrSeries = $state<ArrSeries | null>(null);
	/* The show id arrSeries belongs to. The header reads `arrShown`, which is null
	   whenever this doesn't match the current show — so on navigation the old
	   show's monitored icon is gone *synchronously* (a $derived recomputes before
	   any $effect runs), with no stale frame. */
	let arrSeriesId = $state<string | null>(null);
	const arrShown = $derived(arrSeriesId === data.mediaId ? arrSeries : null);
	let manageOpen = $state(false);

	async function refreshArr() {
		if (!arrManageOn('tv')) return;
		try {
			const r = await fetch(`/api/arr/title?mediaType=tv&tmdbId=${encodeURIComponent(data.mediaId)}`);
			if (r.ok) {
				arrSeries = ((await r.json()) as { series: ArrSeries | null }).series ?? null;
				arrSeriesId = data.mediaId;
			}
		} catch {
			/* a down Sonarr just means no download controls — the page still works */
		}
	}

	/* Re-fetch whenever the show changes. SvelteKit reuses this component across
	   show→show navigation, so an onMount-only load would never refresh. The
	   id-matched `arrShown` above is what prevents a stale icon; this just loads. */
	$effect(() => {
		const id = data.mediaId;
		void data.source;
		let cancelled = false;
		(async () => {
			await loadArrStatus();
			if (cancelled || !arrManageOn('tv')) return;
			try {
				const r = await fetch(`/api/arr/title?mediaType=tv&tmdbId=${encodeURIComponent(id)}`);
				if (!cancelled && r.ok) {
					arrSeries = ((await r.json()) as { series: ArrSeries | null }).series ?? null;
					arrSeriesId = id;
				}
			} catch {
				/* down Sonarr → no controls */
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	/* The synopsis is clamped so a long one doesn't push the seasons off-screen.
	   The "more" link only appears when the text actually overflows the clamp —
	   measured, so a short synopsis gets no dangling toggle. */
	let synopsisOpen = $state(false);
	let synopsisEl: HTMLParagraphElement | undefined = $state();
	let synopsisOverflows = $state(false);
	$effect(() => {
		const el = synopsisEl;
		if (el && !synopsisOpen) synopsisOverflows = el.scrollHeight > el.clientHeight + 2;
	});

	/** Optimistic season toggles, layered over whatever the streamed show holds. */
	let overrides = $state<Record<number, SeasonSummary>>({});
	let busy = $state<Set<number>>(new Set());
	let note = $state<string | null>(null);

	const seasonsOf = (show: ShowDetail) =>
		show.seasons
			.map((s) => overrides[s.seasonNumber] ?? s)
			// Specials (season 0) sort last — rarely what you came for.
			.sort((a, b) =>
				a.seasonNumber === 0 ? 1 : b.seasonNumber === 0 ? -1 : a.seasonNumber - b.seasonNumber
			);

	const year = (iso: string | null) => (iso ? new Date(iso).getFullYear() : null);
	const pct = (p: number | null, max: number | null) =>
		max && max > 0 && p !== null ? Math.min(100, (p / max) * 100) : 0;

	/* The hero's overall bar reads the server totals adjusted by the optimistic
	   season overrides, so marking a season here moves it at once instead of only
	   after the next load. Delta form (not a re-sum) keeps the server's own count
	   as the base — which may exclude specials the way a naive per-season sum would
	   not — and collapses to the server value when nothing is overridden. */
	const overallWithOverrides = (show: ShowDetail) => {
		let dp = 0;
		let dm = 0;
		for (const s of show.seasons) {
			const o = overrides[s.seasonNumber];
			if (!o) continue;
			dp += (o.progress ?? 0) - (s.progress ?? 0);
			dm += (o.maxProgress ?? 0) - (s.maxProgress ?? 0);
		}
		return { progress: (show.progress ?? 0) + dp, max: (show.maxProgress ?? 0) + dm };
	};
	/* What a whole-season action targets: the episodes that have aired, not the
	   full announced count. Marking a currently-airing season should catch you up
	   to what's out, never tick episodes that haven't aired. Falls back to the
	   total for an ended show (airedMax === maxProgress there anyway). */
	const airedMaxOf = (s: SeasonSummary) => s.airedMax ?? s.maxProgress;

	const complete = (s: SeasonSummary) => {
		const m = airedMaxOf(s);
		return m !== null && m > 0 && s.progress !== null && s.progress >= m;
	};

	/**
	 * What to badge a show with.
	 *
	 * While a show is still running, the network is how you think of it — Below
	 * Deck Mediterranean is on Bravo, not on "fuboTV, Peacock, YouTube TV", which
	 * are just bundles that happen to carry Bravo. Once it has ended the network
	 * stops being actionable and where it streams is the useful answer: Buffy is
	 * on Hulu, and that it once aired on The WB does not help you watch it.
	 */
	function whereToWatch(
		show: ShowDetail,
		extras: { networks: { name: string; logo: string | null }[]; services: { name: string; logo: string | null }[] }
	) {
		const finished = show.status === 'Ended' || show.status === 'Canceled';
		const preferred = finished
			? extras.services.length
				? extras.services
				: extras.networks
			: extras.networks.length
				? extras.networks
				: extras.services;
		return preferred.slice(0, 3);
	}

	function yearLabel(show: ShowDetail): string {
		const years = [
			year(show.firstAirDate),
			show.status === 'Ended' ? year(show.lastAirDate) : null
		].filter((y): y is number => y !== null);
		return years.length === 2 && years[0] !== years[1]
			? `${years[0]}–${years[1]}`
			: String(years[0] ?? '');
	}

	function setBusy(n: number, on: boolean) {
		const next = new Set(busy);
		on ? next.add(n) : next.delete(n);
		busy = next;
	}

	/**
	 * Toggle an entire season.
	 *
	 * Clearing is one DELETE on the season path, which removes every episode's
	 * plays. Marking has to step forward one episode at a time because Floppy's
	 * progress route only accepts increase/decrease — the server route loops.
	 */
	async function toggleSeason(season: SeasonSummary, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		const target = airedMaxOf(season);
		if (busy.has(season.seasonNumber) || !target) return;

		const done = complete(season);
		const before = { ...season };
		if (done && !confirm(`Clear all ${target} episodes of ${season.title}?`)) return;

		haptic();
		setBusy(season.seasonNumber, true);
		overrides = {
			...overrides,
			[season.seasonNumber]: {
				...season,
				progress: done ? 0 : target,
				tracked: true
			}
		};

		try {
			const res = await queuedWrite(`season:tv:${data.mediaId}:${season.seasonNumber}`, done ? 'remove' : 'add', '/api/season', {
				method: done ? 'DELETE' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					source: data.source,
					mediaId: data.mediaId,
					season: season.seasonNumber,
					episodes: target,
					watched: season.progress ?? 0
				})
			}, titleName);
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			touchWatchlist();
			/* Filling a season can be dozens of writes and shows only as a bar
			   sliding; say what happened. */
			void notify(
				done
					? `Cleared ${season.title}`
					: `Marked ${target} episode${target === 1 ? '' : 's'} watched`.replace('  ', ' ')
			);
		} catch (err) {
			overrides = { ...overrides, [season.seasonNumber]: before };
			note = `Couldn't update ${season.title} — ${err instanceof Error ? err.message : err}`;
		} finally {
			setBusy(season.seasonNumber, false);
		}
	}

	/* The hero carries the show's name, so repeating it in the header at rest is
	   the same words twice. It appears only once the hero heading has scrolled
	   under the header, which is the one moment the header has something to say.

	   Measured on scroll rather than with an IntersectionObserver: the observer
	   never fired in the harness, and an effect bound to the element proved
	   equally unverifiable. <svelte:window> and a query at measure time are
	   duller and can actually be tested. */
	let heroVisible = $state(true);
	function measureHero() {
		const el = document.querySelector('[data-hero-title]');
		// Absent while the shell is still loading — nothing to hide behind yet.
		if (!el) {
			heroVisible = true;
			return;
		}
		/* Measured, not assumed. This was hardcoded to 52 while the header is 66
		   here and taller again on a phone, where it also carries the status-bar
		   inset — so the swap happened well after the hero title had actually gone,
		   and by a margin that varied per device. Comparing against the header's
		   real bottom edge makes the handover exact in both directions. */
		const header = document.querySelector('header');
		const edge = header ? header.getBoundingClientRect().bottom : 0;
		heroVisible = el.getBoundingClientRect().bottom > edge;
	}
	/* Coalesced into a single rAF so a burst of scroll/resize events measures
	   once per frame rather than reflowing on every event. */
	let measureQueued = false;
	function scheduleMeasure() {
		if (measureQueued) return;
		measureQueued = true;
		requestAnimationFrame(() => {
			measureQueued = false;
			measureHero();
		});
	}

	let statusOpen = $state(false);
	let ratingOpen = $state(false);
	let menuOpen = $state(false);
	/* Optimistic overlay on the server's tracking, cleared when a load brings a
	   fresh one. Same shape as jointEdit and for the same reason. */
	let trackEdit = $state<Tracking | null>(null);

	/* `base` is passed in rather than read from a store: the server value lives
	   inside an {#await} in the markup, and the optimistic overlay has to merge
	   onto whichever of the two is current. */
	async function patchTracking(base: Tracking, change: { status?: number; score?: number | null }) {
		if (trackBusy) return;
		const before = trackEdit;
		trackBusy = true;
		trackEdit = { ...base, ...change, tracked: true };
		try {
			const res = await queuedWrite(`tracking:tv:${data.mediaId}:${Object.keys(change).join('-')}`, 'set', '/api/tracking', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaType: 'tv',
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

	/* Library membership lives in the shared overlay (status.svelte.ts) so a toggle
	   here also flips the plus on the Search/Discover tiles for this title without
	   a reload; the loaded `show.tracked` is the fallback. */
	let trackBusy = $state(false);

	async function toggleTracked(current: boolean, showTitle: string) {
		if (trackBusy) return;
		const next = !current;

		/* Removing throws away whatever progress Floppy holds for the show, which
		   is not something to discover afterwards. Adding needs no such warning. */
		if (!next && !confirm('Remove this from your library? Any watched progress goes with it.')) return;
		if (!next) menuOpen = false;

		trackBusy = true;
		setTitle(data.source, data.mediaId, { tracked: next });
		try {
			const res = await queuedWrite(`library:tv:${data.mediaId}`, next ? 'add' : 'remove', '/api/library', {
				method: next ? 'POST' : 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				// This route renders TV; films have their own page under /movie.
				body: JSON.stringify({ mediaType: 'tv', source: data.source, mediaId: data.mediaId, title: showTitle })
			});
			const body = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(body.message ?? `HTTP ${res.status}`);
			confirmTitle(data.source, data.mediaId, { tracked: next });
			touchWatchlist();
			if (next) confirmShowAdded({ source: data.source, mediaId: data.mediaId, title: showTitle }, body, 'Added to your library');
			else void notify('Removed from your library');
		} catch (err) {
			revertTitle(data.source, data.mediaId, ['tracked']);
			note = `Couldn't ${next ? 'add' : 'remove'} — ${err instanceof Error ? err.message : err}`;
		} finally {
			trackBusy = false;
		}
		// The row is gone or new, so whatever status it had no longer applies.
		trackEdit = null;
	}

	/* §11: joint vs solo is show-level in this household, so a tag on the item is
	   the whole mechanism — no Floppy changes, no per-play attribution. */
	/* Anime or not (the Shows/Anime split): Floppy's genre decides, and the menu
	   overrules it for the household. Local value wins until the next load. */
	let animeEdit = $state<boolean | null>(null);
	async function setAnime(next: boolean, showTitle: string) {
		const before = animeEdit;
		animeEdit = next;
		menuOpen = false;
		try {
			const res = await fetch('/api/anime', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mediaId: data.mediaId, anime: next })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
			touchWatchlist();
			void notify(next ? `${showTitle} is in Anime now` : `${showTitle} is in Shows now`);
		} catch (err) {
			animeEdit = before;
			note = `Couldn't change that — ${err instanceof Error ? err.message : err}`;
		}
	}

	let jointEdit = $state<boolean | null>(null);
	let jointBusy = $state(false);

	async function toggleJoint(current: boolean, showTitle: string) {
		if (jointBusy) return;
		const before = jointEdit;
		const next = !current;
		jointBusy = true;
		jointEdit = next;
		try {
			const res = await queuedWrite(`tags:tv:${data.mediaId}`, 'set', '/api/tags', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaType: 'tv',
					source: data.source,
					mediaId: data.mediaId,
					joint: next,
					title: showTitle
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
</script>

<svelte:window onscroll={scheduleMeasure} onresize={scheduleMeasure} />

{#await data.show}
	<!-- The shell appears the instant the row is tapped, so a tap always does
	     something visible and never reads as a frozen app. -->
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
		<div class="skrows">
			{#each Array(5) as _, i (i)}
				<Skeleton height="62px" radius={12} />
			{/each}
		</div>
	</main>
{:then show}
	{@const tracked = trackedOf(data.source, data.mediaId, show.tracked)}
	{#snippet headerActions()}
		<div class="hactions">
			<!-- When the show is in Sonarr and management is on, this opens the
			     download-settings sheet; otherwise it's the plain add button. -->
			{#if arrShown && arrManageOn('tv') && !navigating.to}
				<button
					class="manage"
					class:monitored={arrShown.monitored}
					aria-label={arrShown.monitored ? 'Monitored in Sonarr — manage downloads' : 'Not monitored — manage downloads'}
					onclick={() => (manageOpen = true)}
				>
					<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="6" rx="1.6" /><rect x="3" y="13.5" width="18" height="6" rx="1.6" /><path d="M6.5 7.5h.01M6.5 16.5h.01" /></svg>
				</button>
			{:else}
				<ArrButton mediaType="tv" tmdbId={data.mediaId} title={show.title} onadd={(i) => (arrRequest = i)} compact size={38} />
			{/if}
			{#if tracked}
				<button class="menu" aria-label="More" onclick={() => (menuOpen = true)}>
					<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
				</button>
			{/if}
		</div>
	{/snippet}

	<PageHeader
		title={show.title}
		titleHidden={heroVisible}
		action={headerActions}
		onback={() => history.back()}
	/>

	<main>
		<section class="hero">
			<Poster src={show.poster} width={104} height={156} radius={10} eager />
			<div class="facts">
				<h1 data-hero-title>{show.title}</h1>
				<!-- The years sit with the chips rather than on their own line: it is
				     the same kind of fact, and a line to itself pushed everything
				     below it down for one short string. -->
				<p class="chips tnum">
					{#if yearLabel(show)}<span class="chip">{yearLabel(show)}</span>{/if}
					{#if show.status}<span class="chip">{show.status}</span>{/if}
					{#if show.score}<span class="chip">★ {show.score.toFixed(1)}</span>{/if}
					{#if show.runtime}<span class="chip">{formatRuntime(show.runtime)}</span>{/if}
				</p>

				{#await data.extras then extras}
					{@const where = whereToWatch(show, extras)}
					{#if where.length}
						<p class="where">
							{#each where as w (w.name)}
								<span class="badge">
									{#if w.logo}<img src={w.logo} alt="" />{/if}
									{w.name}
								</span>
							{/each}
						</p>
					{/if}
				{/await}

				{#if show.genres.length}
					<p class="genres">{show.genres.join(' · ')}</p>
				{/if}

				{#if show.maxProgress}
					{@const op = overallWithOverrides(show)}
					<div class="overall">
						<div class="track"><div class="fill" style:width={`${pct(op.progress, op.max)}%`}></div></div>
						<span class="tnum">{op.progress}/{op.max}</span>
					</div>
				{/if}
			</div>
		</section>

		{#await data.tracking then loaded}
			{@const serverTracking = loaded}
			{@const t = trackEdit ?? serverTracking}
			{#if tracked}
				{#await data.joint then serverJoint}
					{@const joint = jointEdit ?? serverJoint}
					<StateChips
						tracking={t}
						{joint}
						showCompany={data.companyTracking}
						busy={trackBusy || jointBusy}
						onmain={() => (statusOpen = true)}
						onrating={() => (ratingOpen = true)}
						oncompany={() => toggleJoint(joint, show.title)}
					/>
					{#if joint && data.sharedWith?.length && data.companyTracking}
						<p class="sharednote">Shared with {data.sharedWith.join(' & ')} — a play by either of you counts for both.</p>
					{/if}
				{/await}
			{:else}
				<!-- The one thing worth doing on a show you do not have, so it gets the
				     full width and the accent rather than a quiet pill. -->
				<button class="add" disabled={trackBusy} onclick={() => toggleTracked(false, show.title)}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
					<span>Add to library</span>
				</button>
			{/if}

			{#if statusOpen && tracked}
				<StatusSheet
					title={show.title}
					status={t.status}
					busy={trackBusy}
					onpick={(status) => patchTracking(t, { status })}
					onclose={() => (statusOpen = false)}
				/>
			{/if}

			{#if ratingOpen && tracked}
				<RatingSheet
					title={show.title}
					score={t.score}
					busy={trackBusy}
					onpick={(score) => patchTracking(t, { score })}
					onclose={() => (ratingOpen = false)}
				/>
			{/if}

			{#if menuOpen && tracked}
				{#await data.anime then serverAnime}
					<ItemMenu
						title={show.title}
						sourceUrl={show.sourceUrl}
						busy={trackBusy}
						anime={animeEdit ?? serverAnime}
						onanime={(next) => setAnime(next, show.title)}
						onremove={() => toggleTracked(true, show.title)}
						onclose={() => (menuOpen = false)}
					/>
				{/await}
			{/if}
		{/await}

		{#if show.synopsis}
			<div class="synopsis">
				<p bind:this={synopsisEl} class:clamped={!synopsisOpen}>{show.synopsis}</p>
				{#if synopsisOverflows || synopsisOpen}
					<button class="more" onclick={() => (synopsisOpen = !synopsisOpen)}>
						{synopsisOpen ? 'Show less' : 'more…'}
					</button>
				{/if}
			</div>
		{/if}

		<section>
			<h2>Seasons</h2>
			<ul class="seasons">
				{#each seasonsOf(show) as s (s.seasonNumber)}
					<li>
						<!-- Outside the <a> so tapping it toggles rather than navigates. -->
						<button
							class="check"
							class:watched={complete(s)}
							disabled={!airedMaxOf(s)}
							aria-pressed={complete(s)}
							aria-label={`Mark ${s.title} watched`}
							onclick={(e) => toggleSeason(s, e)}
						>
							{#if complete(s)}
								<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
							{/if}
						</button>

						<a href="/show/{data.source}/{data.mediaId}/{s.seasonNumber}" class:with-art={data.seasonArtwork}>
							{#if data.seasonArtwork}
								<Poster src={s.poster} width={44} height={44} />
							{/if}
							<div class="s-meta">
								<span class="s-title">{s.seasonNumber === 0 ? 'Specials' : `Season ${s.seasonNumber}`}</span>
								<div class="s-progress">
									<div class="track">
										<div class="fill" style:width={`${pct(s.progress, airedMaxOf(s))}%`}></div>
									</div>
									<span class="tnum dim">
										{#if s.progress !== null && airedMaxOf(s)}{s.progress}/{airedMaxOf(s)}
										{:else if s.progress !== null}{s.progress} watched
										{:else}Not started{/if}
									</span>
								</div>
							</div>
							<svg class="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
								<path d="m9 18 6-6-6-6" />
							</svg>
						</a>
					</li>
				{/each}
			</ul>
		</section>

		{#if show.cast.length}
			<section>
				<h2>Cast</h2>
				<ul class="cast">
					{#each show.cast as person (person.name + (person.role ?? ''))}
						<li>
							<!-- Tapping a face searches that name — how you find the other
							     thing you know them from. -->
							<button onclick={() => goto(`/discover?q=${encodeURIComponent(person.name)}`)}>
								<Poster src={person.image} width={78} height={78} radius={39} />
								<span class="name">{person.name}</span>
								{#if person.role}<span class="role">{person.role}</span>{/if}
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#await data.extras then extras}
			{#if extras.similar.length}
				<section>
					<h2>Shows like this</h2>
					<ul class="rail">
						{#each extras.similar as rec (rec.mediaId)}
							<li>
								<button onclick={() => goto(`/show/tmdb/${rec.mediaId}`)}>
									<Poster src={rec.poster} width={104} height={156} radius={9} />
									<span class="cap">{rec.title}</span>
									<span class="sub tnum">{[rec.year, rec.rating ? `★ ${rec.rating}` : null].filter(Boolean).join(' · ')}</span>
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/await}

		{#if show.studios.length}
			<p class="studios">{show.studios.join(' · ')}</p>
		{/if}
	</main>
{:catch err}
	{@const missing = notLinkedOf(err)}
	<PageHeader title="" onback={() => history.back()} />
	<main>
		{#if missing}
			<NotLinked service={missing} />
		{:else}
			<div class="failed">
				<h2>Couldn't load that show</h2>
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
	<SeriesManageSheet
		tmdbId={data.mediaId}
		title={arrShown.title}
		series={arrShown}
		onchange={refreshArr}
		onclose={() => (manageOpen = false)}
	/>
{/if}

<style>
	main { padding: 0 var(--gutter) calc(var(--safe-b) + 32px); }

	.hero { display: grid; grid-template-columns: 104px 1fr; gap: 14px; margin: 8px 0 16px; }
	.facts { display: flex; flex-direction: column; justify-content: center; gap: 8px; min-width: 0; }
	h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }

	.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
	.chip { padding: 3px 9px; border-radius: 7px; background: var(--surface-raised); font-size: 12px; color: var(--text-dim); }

	.where { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
	.badge {
		display: inline-flex; align-items: center; gap: 6px;
		padding: 3px 9px 3px 3px; border-radius: 7px;
		background: var(--surface-raised); font-size: 12px; font-weight: 600;
	}
	.badge img { width: 18px; height: 18px; border-radius: 4px; object-fit: cover; }

	.genres { margin: 0; font-size: 12.5px; color: var(--text-dim); }
	.overall { display: flex; align-items: center; gap: 9px; font-size: 12px; color: var(--text-dim); }

	.track { flex: 1; height: 5px; min-width: 40px; border-radius: 3px; background: var(--surface-raised); overflow: hidden; }
	.fill { height: 100%; border-radius: 3px; background: var(--signal); }


	.menu, .manage {
		display: grid; place-items: center;
		width: var(--tap); height: var(--tap);
		border-radius: 50%; color: var(--text-dim);
	}
	/* Dim = not monitored, accent = monitored, so the show's monitored state reads
	   at a glance from the one header glyph. */
	.manage { color: var(--text-dim); }
	.manage.monitored { color: var(--signal-solid); }

	/* The one action worth taking on a show you do not have, so it takes the
	   full width and the accent. */
	.sharednote { margin: 8px 0 0; font-size: 12.5px; color: var(--text-dim); }
	.add {
		display: flex; align-items: center; justify-content: center; gap: 9px;
		width: 100%; min-height: var(--tap); margin: 0 0 16px;
		border-radius: var(--radius); background: var(--signal);
		font-size: 15px; font-weight: 600; color: #fff;
	}
	.add:disabled { opacity: 0.6; }

	/* Sonarr/Radarr add + overflow menu, side by side in the header. */
	.hactions { display: flex; align-items: center; gap: 2px; }

	.synopsis { margin: 0 0 22px; }
	.synopsis p { margin: 0; font-size: 14.5px; line-height: 1.55; }
	.synopsis p.clamped {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.more {
		margin-top: 4px;
		font-size: 13px;
		font-weight: 600;
		color: var(--signal-solid);
	}

	section h2 {
		margin: 0 0 10px; font-size: 13px; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim);
	}

	.seasons { display: flex; flex-direction: column; gap: 6px; margin: 0 0 24px; padding: 0; list-style: none; }
	.seasons li {
		display: grid; grid-template-columns: var(--tap) 1fr;
		align-items: center; border-radius: var(--radius); background: var(--surface);
	}
	.seasons a {
		display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 12px;
		min-height: 62px; padding: 10px 14px 10px 0; min-width: 0;
	}
	.seasons a.with-art { grid-template-columns: 44px 1fr auto; }

	.check {
		position: relative; display: grid; place-items: center;
		width: var(--tap); height: var(--tap); justify-self: center;
	}
	.check::before {
		content: ''; position: absolute; width: 24px; height: 24px;
		border-radius: 50%; border: 1.8px solid var(--surface-raised);
	}
	.check.watched::before { border-color: transparent; background: var(--signal); }
	.check svg { position: relative; color: #fff; }
	.check:disabled { opacity: 0.4; }

	.s-meta { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
	.s-title { font-size: 15px; font-weight: 600; }
	.s-progress { display: flex; align-items: center; gap: 9px; }
	.dim { font-size: 11.5px; color: var(--text-dim); flex: none; }
	.chev { color: var(--text-dim); }

	.cast {
		display: flex; gap: 12px; margin: 0 0 24px; padding: 0 var(--gutter) 4px 0;
		list-style: none; overflow-x: auto;
		scroll-snap-type: x proximity; scroll-padding-left: var(--gutter);
	}
	.cast li { flex: none; width: 78px; scroll-snap-align: start; }
	.cast :global(img), .cast :global(.ph) { margin-bottom: 6px; }
	.name { display: block; font-size: 12px; font-weight: 600; line-height: 1.3; }
	.role { display: block; font-size: 11px; color: var(--text-dim); line-height: 1.3; }

	.rail {
		display: flex; gap: 12px; margin: 8px 0 24px; padding: 0 var(--gutter) 4px 0;
		list-style: none; overflow-x: auto;
		scroll-snap-type: x proximity; scroll-padding-left: var(--gutter);
	}
	.rail li { flex: none; width: 104px; scroll-snap-align: start; }
	.cap {
		display: -webkit-box; margin-top: 6px; font-size: 12px; font-weight: 600; line-height: 1.3;
		overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
	}
	.sub { display: block; font-size: 11px; color: var(--text-dim); }

	.studios { margin: 0; font-size: 12px; color: var(--text-dim); }

	.loading { display: flex; flex-direction: column; gap: 10px; }
	.loading .facts { display: flex; flex-direction: column; justify-content: center; gap: 10px; }
	.skrows { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }

	.failed { margin-top: 20vh; text-align: center; }
	.failed h2 { margin: 0 0 8px; font-size: 17px; text-transform: none; letter-spacing: 0; color: var(--text); }
	.failed p { margin: 0; font-size: 14px; color: var(--text-dim); }

	.note {
		position: fixed; left: var(--gutter); right: var(--gutter);
		bottom: calc(var(--safe-b) + 12px); z-index: 60;
		display: flex; align-items: center; gap: 10px;
		padding: 12px 8px 12px 16px; border-radius: var(--radius);
		background: var(--surface-raised); box-shadow: var(--shadow-lg);
		font-size: 13.5px;
	}
	.note span { flex: 1; }
	.note button { flex: none; width: var(--tap); height: var(--tap); font-size: 22px; color: var(--text-dim); }
</style>
