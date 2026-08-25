<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Poster from '$lib/components/Poster.svelte';
	import { formatRuntime } from '$lib/format';
	import { haptic } from '$lib/haptics';
	import type { SeasonSummary } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/* Optimistic overlay, same shape as the watchlist: derive from the server
	   payload so the page still server-renders, and layer local edits on top. */
	let overrides = $state<Record<number, SeasonSummary>>({});
	const show = $derived({
		...data.show,
		seasons: data.show.seasons.map((s) => overrides[s.seasonNumber] ?? s)
	});

	let busy = $state<Set<number>>(new Set());
	let note = $state<string | null>(null);

	/* §11: joint vs solo is show-level in this household, so a tag on the item is
	   the whole mechanism — no Floppy changes, no per-play attribution. */
	let jointEdit = $state<boolean | null>(null);
	const joint = $derived(jointEdit ?? data.joint);
	let jointBusy = $state(false);

	async function toggleJoint() {
		if (jointBusy) return;
		const before = jointEdit;
		const next = !joint;
		jointBusy = true;
		jointEdit = next;
		try {
			const res = await fetch('/api/tags', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mediaType: 'tv',
					source: show.source,
					mediaId: show.mediaId,
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

	function setBusy(n: number, on: boolean) {
		const next = new Set(busy);
		on ? next.add(n) : next.delete(n);
		busy = next;
	}

	/**
	 * Toggle an entire season.
	 *
	 * Unmarking is a single DELETE on the season path, which clears every
	 * episode's plays. Marking has to step the season forward one episode at a
	 * time because Floppy's progress route only accepts increase/decrease — there
	 * is no "set to N" — so the server route loops, sequentially (§12.1).
	 */
	async function toggleSeason(season: SeasonSummary, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (busy.has(season.seasonNumber) || !season.maxProgress) return;

		const complete = season.progress !== null && season.progress >= season.maxProgress;
		const before = { ...season };

		if (complete && !confirm(`Clear all ${season.maxProgress} episodes of ${season.title}?`)) return;

		haptic();
		setBusy(season.seasonNumber, true);
		overrides = {
			...overrides,
			[season.seasonNumber]: {
				...season,
				progress: complete ? 0 : season.maxProgress,
				tracked: true
			}
		};

		try {
			const res = await fetch('/api/season', {
				method: complete ? 'DELETE' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					source: show.source,
					mediaId: show.mediaId,
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

	const year = (iso: string | null) => (iso ? new Date(iso).getFullYear() : null);
	const pct = (p: number | null, max: number | null) =>
		max && max > 0 && p !== null ? Math.min(100, (p / max) * 100) : 0;

	const years = $derived(
		[year(show.firstAirDate), show.status === 'Ended' ? year(show.lastAirDate) : null]
			.filter((y): y is number => y !== null)
	);
	const yearLabel = $derived(
		years.length === 2 && years[0] !== years[1] ? `${years[0]}–${years[1]}` : String(years[0] ?? '')
	);

	// Specials (season 0) sort last — they're rarely what you came for.
	const seasons = $derived(
		[...show.seasons].sort((a, b) =>
			a.seasonNumber === 0 ? 1 : b.seasonNumber === 0 ? -1 : a.seasonNumber - b.seasonNumber
		)
	);
</script>

<PageHeader title={show.title} subtitle={yearLabel || null} onback={() => history.back()} />

<main>
	<section class="hero">
		<Poster src={show.poster} width={104} height={156} radius={10} eager />
		<div class="facts">
			<h1>{show.title}</h1>
			<p class="chips tnum">
				{#if show.status}<span class="chip">{show.status}</span>{/if}
				{#if show.score}<span class="chip">★ {show.score.toFixed(1)}</span>{/if}
				{#if show.runtime}<span class="chip">{formatRuntime(show.runtime)}</span>{/if}
			</p>
			{#if data.extras.services.length || data.extras.networks.length}
					<!-- What it streams on now, falling back to the broadcast network
					     for older shows that are not on a service. -->
					<p class="where">
						{#each (data.extras.services.length ? data.extras.services : data.extras.networks).slice(0, 3) as w (w.name)}
							<span class="badge">
								{#if w.logo}<img src={w.logo} alt="" />{/if}
								{w.name}
							</span>
						{/each}
					</p>
			{/if}

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

	<button class="joint" class:on={joint} disabled={jointBusy} aria-pressed={joint} onclick={toggleJoint}>
		<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
			<circle cx="9" cy="8" r="3.2" />
			<circle cx="16.5" cy="9.5" r="2.6" />
			<path d="M3.2 19a6 6 0 0 1 11.6 0M16 13.6a5 5 0 0 1 4.8 4.2" />
		</svg>
		<span>{joint ? 'Watched together' : 'Watched alone'}</span>
	</button>

	{#if show.synopsis}
		<p class="synopsis">{show.synopsis}</p>
	{/if}

	<section>
		<h2>Seasons</h2>
		<ul class="seasons">
			{#each seasons as s (s.seasonNumber)}
				<li class:busy={busy.has(s.seasonNumber)}>
					<!-- Off by default: Floppy returns the show's poster for every
					     season, so it is usually a column of identical images. Some
					     shows do have distinct art, hence the setting. -->
					<!-- Outside the <a> so tapping it toggles rather than navigates. -->
					<button
						class="check"
						class:watched={s.maxProgress !== null && s.progress !== null && s.progress >= s.maxProgress}
						disabled={busy.has(s.seasonNumber) || !s.maxProgress}
						aria-pressed={s.maxProgress !== null && s.progress !== null && s.progress >= s.maxProgress}
						aria-label={`Mark ${s.title} watched`}
						onclick={(e) => toggleSeason(s, e)}
					>
						{#if s.maxProgress !== null && s.progress !== null && s.progress >= s.maxProgress}
							<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
						{/if}
					</button>

					<a href="/show/{show.source}/{show.mediaId}/{s.seasonNumber}" class:with-art={data.seasonArtwork}>
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
						<!-- Tapping a face searches for that name, which is how you find
						     the other thing you know them from. -->
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

	{#if data.extras.similar.length}
			<section>
				<h2>Shows like this</h2>
				<ul class="rail">
					{#each data.extras.similar as rec (rec.mediaId)}
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

	{#if show.studios.length}
		<p class="studios">{show.studios.join(' · ')}</p>
	{/if}
</main>

{#if note}
	<div class="note" role="status">
		<span>{note}</span>
		<button onclick={() => (note = null)} aria-label="Dismiss">×</button>
	</div>
{/if}

<style>
	main {
		padding: 0 var(--gutter) calc(var(--safe-b) + 32px);
	}

	.hero {
		display: grid;
		grid-template-columns: 104px 1fr;
		gap: 14px;
		margin: 8px 0 16px;
	}

	.facts {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 8px;
		min-width: 0;
	}
	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
	}
	.chip {
		padding: 3px 9px;
		border-radius: 7px;
		background: var(--surface-raised);
		font-size: 12px;
		color: var(--text-dim);
	}
	.genres {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-dim);
	}

	.overall {
		display: flex;
		align-items: center;
		gap: 9px;
		font-size: 12px;
		color: var(--text-dim);
	}

	.track {
		flex: 1;
		height: 5px;
		min-width: 40px;
		border-radius: 3px;
		background: var(--surface-raised);
		overflow: hidden;
	}
	.fill {
		height: 100%;
		border-radius: 3px;
		background: var(--signal);
	}

	.joint {
		display: flex;
		align-items: center;
		gap: 9px;
		min-height: var(--tap);
		padding: 0 14px;
		margin: 0 0 16px;
		border-radius: var(--radius);
		background: var(--surface);
		font-size: 14px;
		font-weight: 600;
		color: var(--text-dim);
	}
	.joint.on {
		background: var(--signal);
		color: #fff;
	}
	.joint:disabled {
		opacity: 0.6;
	}

	.synopsis {
		margin: 0 0 22px;
		font-size: 14.5px;
		line-height: 1.55;
	}

	section h2 {
		margin: 0 0 10px;
		font-size: 13px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-dim);
	}

	.seasons {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 0 0 24px;
		padding: 0;
		list-style: none;
	}
	.seasons li {
		display: grid;
		grid-template-columns: var(--tap) 1fr;
		align-items: center;
		border-radius: var(--radius);
		background: var(--surface);
	}
	.seasons li.busy {
		opacity: 0.6;
	}
	.seasons a {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 12px;
		min-height: 62px;
		padding: 10px 4px 10px 14px;
		min-width: 0;
	}
	.seasons a.with-art {
		grid-template-columns: 44px 1fr auto;
		padding-left: 8px;
	}

	.check {
		position: relative;
		display: grid;
		place-items: center;
		width: var(--tap);
		height: var(--tap);
		justify-self: center;
	}
	.check::before {
		content: '';
		position: absolute;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 1.8px solid var(--surface-raised);
	}
	.check.watched::before {
		border-color: transparent;
		background: var(--signal);
	}
	.check svg {
		position: relative;
		color: #fff;
	}
	.check:disabled {
		opacity: 0.4;
	}
	.s-meta {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.s-title {
		font-size: 15px;
		font-weight: 600;
	}
	.s-progress {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.dim {
		font-size: 11.5px;
		color: var(--text-dim);
		flex: none;
	}
	.chev {
		color: var(--text-dim);
	}

	.cast {
		display: flex;
		gap: 12px;
		margin: 0 0 24px;
		padding: 0 var(--gutter) 4px 0;
		list-style: none;
		overflow-x: auto;
		scroll-snap-type: x proximity;
		scroll-padding-left: var(--gutter);
	}
	.cast li {
		flex: none;
		width: 78px;
		scroll-snap-align: start;
	}
	.cast :global(img),
	.cast :global(.ph) {
		margin-bottom: 6px;
	}
	.name {
		display: block;
		font-size: 12px;
		font-weight: 600;
		line-height: 1.3;
	}
	.role {
		display: block;
		font-size: 11px;
		color: var(--text-dim);
		line-height: 1.3;
	}

	.where { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
	.badge {
		display: inline-flex; align-items: center; gap: 6px;
		padding: 3px 9px 3px 3px; border-radius: 7px;
		background: var(--surface-raised); font-size: 12px; font-weight: 600;
	}
	.badge img { width: 18px; height: 18px; border-radius: 4px; object-fit: cover; }
	.badge:has(img) { padding-left: 3px; }

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

	.studios {
		margin: 0;
		font-size: 12px;
		color: var(--text-dim);
	}

	.note {
		position: fixed;
		left: var(--gutter);
		right: var(--gutter);
		bottom: calc(var(--safe-b) + 12px);
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 8px 12px 16px;
		border-radius: var(--radius);
		background: var(--surface-raised);
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
		font-size: 13.5px;
	}
	.note span { flex: 1; }
	.note button { flex: none; width: var(--tap); height: var(--tap); font-size: 22px; color: var(--text-dim); }
</style>
