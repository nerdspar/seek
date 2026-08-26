<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import TrackingSheet from '$lib/components/TrackingSheet.svelte';
	import { statusLabel, type Tracking } from '$lib/tracking';
	import { formatRuntime } from '$lib/format';
	import { haptic } from '$lib/haptics';
	import type { SeasonSummary, ShowDetail } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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
	const complete = (s: SeasonSummary) =>
		s.maxProgress !== null && s.progress !== null && s.progress >= s.maxProgress;

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
		if (busy.has(season.seasonNumber) || !season.maxProgress) return;

		const done = complete(season);
		const before = { ...season };
		if (done && !confirm(`Clear all ${season.maxProgress} episodes of ${season.title}?`)) return;

		haptic();
		setBusy(season.seasonNumber, true);
		overrides = {
			...overrides,
			[season.seasonNumber]: {
				...season,
				progress: done ? 0 : season.maxProgress,
				tracked: true
			}
		};

		try {
			const res = await fetch('/api/season', {
				method: done ? 'DELETE' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					source: data.source,
					mediaId: data.mediaId,
					season: season.seasonNumber,
					episodes: season.maxProgress,
					watched: season.progress ?? 0
				})
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
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
		heroVisible = !el || el.getBoundingClientRect().bottom > 52;
	}

	let sheetOpen = $state(false);
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
			const res = await fetch('/api/tracking', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaType: 'tv',
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

	/* Library membership. Optimistic like everything else here, and re-synced
	   from the server value whenever a fresh load arrives. */
	let trackedEdit = $state<boolean | null>(null);
	let trackBusy = $state(false);

	async function toggleTracked(current: boolean) {
		if (trackBusy) return;
		const before = trackedEdit;
		const next = !current;

		/* Removing throws away whatever progress Floppy holds for the show, which
		   is not something to discover afterwards. Adding needs no such warning. */
		if (!next && !confirm('Remove this from your library? Any watched progress goes with it.')) return;
		if (!next) sheetOpen = false;

		trackBusy = true;
		trackedEdit = next;
		try {
			const res = await fetch('/api/library', {
				method: next ? 'POST' : 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				// This route only ever renders TV; movies have no detail page yet.
				body: JSON.stringify({ mediaType: 'tv', source: data.source, mediaId: data.mediaId })
			});
			if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `HTTP ${res.status}`);
		} catch (err) {
			trackedEdit = before;
			note = `Couldn't ${next ? 'add' : 'remove'} — ${err instanceof Error ? err.message : err}`;
		} finally {
			trackBusy = false;
		}
		// The row is gone or new, so whatever status it had no longer applies.
		trackEdit = null;
	}

	/* §11: joint vs solo is show-level in this household, so a tag on the item is
	   the whole mechanism — no Floppy changes, no per-play attribution. */
	let jointEdit = $state<boolean | null>(null);
	let jointBusy = $state(false);

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
					mediaType: 'tv',
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
</script>

<svelte:window onscroll={measureHero} onresize={measureHero} />

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
	{@const tracked = trackedEdit ?? show.tracked}
	<PageHeader title={show.title} titleHidden={heroVisible} onback={() => history.back()} />

	<main>
		<section class="hero">
			<Poster src={show.poster} width={104} height={156} radius={10} eager />
			<div class="facts">
				<h1 data-hero-title>{show.title}</h1>
				{#if yearLabel(show)}<p class="years">{yearLabel(show)}</p>{/if}
				<p class="chips tnum">
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
					<div class="overall">
						<div class="track"><div class="fill" style:width={`${pct(show.progress, show.maxProgress)}%`}></div></div>
						<span class="tnum">{show.progress}/{show.maxProgress}</span>
					</div>
				{/if}
			</div>
		</section>

		{#await data.tracking then loaded}
			{@const serverTracking = loaded}
			{@const t = trackEdit ?? serverTracking}
			{#if tracked}
				<!-- The status is the membership indicator. "Watching" says the show is in
				     your library and says something an "In your library" label cannot. -->
				<button class="state" disabled={trackBusy} onclick={() => (sheetOpen = true)}>
					<span class="pill">{statusLabel(t.status) ?? 'Tracked'}</span>
					{#if t.score !== null}
						<span class="rating tnum">★ {t.score}</span>
					{:else}
						<span class="rate">Rate</span>
					{/if}
					<svg class="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6" /></svg>
				</button>
			{:else}
				<!-- The one thing worth doing on a show you do not have, so it gets the
				     full width and the accent rather than a quiet pill. -->
				<button class="add" disabled={trackBusy} onclick={() => toggleTracked(false)}>
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
					<span>Add to library</span>
				</button>
			{/if}

			{#if sheetOpen && tracked}
				{#await data.joint then serverJoint}
					<TrackingSheet
						title={show.title}
						tracking={t}
						joint={jointEdit ?? serverJoint}
						busy={trackBusy || jointBusy}
						onstatus={(status) => patchTracking(t, { status })}
						onscore={(score) => patchTracking(t, { score })}
						onjoint={(next) => toggleJoint(!next)}
						onremove={() => toggleTracked(true)}
						onclose={() => (sheetOpen = false)}
					/>
				{/await}
			{/if}
		{/await}

		{#if show.synopsis}
			<p class="synopsis">{show.synopsis}</p>
		{/if}

		<section>
			<h2>Seasons</h2>
			<ul class="seasons">
				{#each seasonsOf(show) as s (s.seasonNumber)}
					<li class:busy={busy.has(s.seasonNumber)}>
						<!-- Outside the <a> so tapping it toggles rather than navigates. -->
						<button
							class="check"
							class:watched={complete(s)}
							disabled={busy.has(s.seasonNumber) || !s.maxProgress}
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
										<div class="fill" style:width={`${pct(s.progress, s.maxProgress)}%`}></div>
									</div>
									<span class="tnum dim">
										{#if s.progress !== null && s.maxProgress}{s.progress}/{s.maxProgress}
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
							<button onclick={() => goto(`/search?q=${encodeURIComponent(person.name)}`)}>
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
	<PageHeader title="" onback={() => history.back()} />
	<main>
		<div class="failed">
			<h2>Couldn't load that show</h2>
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


	/* Being in the library is a statement of fact, not an active setting, so the
	   tracked state stays quiet — the accent is reserved for "Add", which is the
	   one thing here worth drawing the eye. */

	/* Quiet: being in the library is a fact, and the status is the fact worth
	   reading. Tapping it opens everything you can change about the show. */
	.state {
		display: flex; align-items: center; gap: 10px;
		min-height: var(--tap); padding: 0 12px 0 4px; margin: 0 0 16px;
		border-radius: var(--radius); background: var(--surface);
		font-size: 14px; color: var(--text-dim);
	}
	.state .pill {
		padding: 5px 11px; border-radius: 8px;
		background: var(--surface-raised); font-weight: 600; color: var(--text);
	}
	.state .rating { font-weight: 600; color: var(--text); }
	.state .rate { color: var(--signal-solid); font-weight: 600; }
	.state .chev { margin-left: auto; opacity: 0.6; }
	.state:disabled { opacity: 0.6; }

	/* The one action worth taking on a show you do not have, so it takes the
	   full width and the accent. */
	.add {
		display: flex; align-items: center; justify-content: center; gap: 9px;
		width: 100%; min-height: var(--tap); margin: 0 0 16px;
		border-radius: var(--radius); background: var(--signal);
		font-size: 15px; font-weight: 600; color: #fff;
	}
	.add:disabled { opacity: 0.6; }

	.years { margin: 2px 0 0; font-size: 13.5px; color: var(--text-dim); }

	.synopsis { margin: 0 0 22px; font-size: 14.5px; line-height: 1.55; }

	section h2 {
		margin: 0 0 10px; font-size: 13px; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim);
	}

	.seasons { display: flex; flex-direction: column; gap: 6px; margin: 0 0 24px; padding: 0; list-style: none; }
	.seasons li {
		display: grid; grid-template-columns: var(--tap) 1fr;
		align-items: center; border-radius: var(--radius); background: var(--surface);
	}
	.seasons li.busy { opacity: 0.6; }
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
