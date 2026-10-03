<script lang="ts">
	import NotLinked from '$lib/components/NotLinked.svelte';
	import { notLinkedOf } from '$lib/notLinked';
	import { afterNavigate, goto } from '$app/navigation';
	import Poster from '$lib/components/Poster.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import { tabReselect } from '$lib/tabReselect';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import { dayKey, dayLabel, epLabel, formatAirDate, relativeWhen } from '$lib/format';
	import type { UpcomingItem } from '$lib/types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// One timestamp for the whole render, so every relative marker agrees.
	const now = new Date();
	const todayKey = dayKey(now.toISOString());

	let todayEl: HTMLElement | undefined = $state();

	/* Every visit lands at Today — scroll up for the last 30 days — except
	   back/forward, where the framework restores where you were.
	   It waits for afterNavigate: SvelteKit resets a new page to the top as the
	   navigation completes, so scrolling any earlier (the list is often already
	   cached and renders at once) was silently undone — the "opens at the top"
	   bug. Also driven off the Today row actually existing, so a slow load still
	   lands. */
	let navType = $state<string | null>(null);
	let anchored = false;
	afterNavigate((nav) => {
		navType = nav.type;
	});
	$effect(() => {
		const el = todayEl;
		if (!el || navType === null || anchored) return;
		anchored = true;
		if (navType === 'popstate') return;
		/* Window-scroll (Model B): land Today just below the sticky header. Direct,
		   not via requestAnimationFrame: getBoundingClientRect forces layout, and the
		   rows carry fixed poster dimensions so the offset is already final — and a
		   backgrounded tab pauses rAF, which would strand it. */
		const header = document.querySelector('.app > header') as HTMLElement | null;
		const off = header?.getBoundingClientRect().height ?? 0;
		window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - off);
	});

	/* Binds `todayEl` to the first non-past day's section. */
	function markToday(node: HTMLElement, isAnchor: boolean) {
		if (isAnchor) todayEl = node;
		return {
			update(next: boolean) {
				if (next) todayEl = node;
				else if (todayEl === node) todayEl = undefined;
			},
			destroy() {
				if (todayEl === node) todayEl = undefined;
			}
		};
	}
	type Group = { key: string; label: string; iso: string; past: boolean; items: UpcomingItem[] };

	/* Everything the feed carries — the last 30 days (kept server-side) up to
	   however far ahead TMDB has scheduled. No forward cap: the feed's own horizon
	   is the only limit, so a filter would only ever hide rows, never add them. */
	const groupBy = (items: UpcomingItem[]): Group[] =>
		items.reduce<Group[]>((acc, item) => {
				const key = dayKey(item.start);
				const last = acc[acc.length - 1];
				if (last?.key === key) last.items.push(item);
				else
					acc.push({
						key,
						label: dayLabel(item.start, now),
						iso: item.start,
						past: key < todayKey,
						items: [item]
					});
				return acc;
			}, []);

</script>

<div class="app">
	<header><h1>Upcoming</h1></header>

	<main use:tabReselect={{ tab: 'upcoming', target: () => todayEl }}>
		{#await data.items}
			<div class="skdays">
				{#each Array(3) as _, g (g)}
					<Skeleton width="38%" height="13px" />
					{#each Array(3) as _, i (i)}
						<Skeleton height="81px" radius={10} />
					{/each}
				{/each}
			</div>
		{:then items}
			{@const groups = groupBy(items)}
			{@const anchorKey = groups.find((g) => !g.past)?.key}
			{@const upcomingCount = groups.reduce((n, g) => n + (g.past ? 0 : g.items.length), 0)}
			{#if !items.length}
				<div class="empty">
					<h2>Nothing scheduled</h2>
					<p>No upcoming episodes for anything you're tracking.</p>
				</div>
			{:else}
			{#each groups as group (group.key)}
				<section class:past={group.past} use:markToday={group.key === anchorKey}>
					<div class="day">
						<span class="label">{group.label}</span>
						{#if relativeWhen(group.iso, now)}
							<span class="rel tnum">{relativeWhen(group.iso, now)}</span>
						{/if}
					</div>

					<ul>
						{#each group.items as item, i (item.title + item.start + i)}
							<li>
								<!-- §5.2's gradient rail. Rendered once per row and joined
								     visually, so the timeline reads as continuous. -->
								<span class="rail" aria-hidden="true"><span class="node"></span></span>

								<button
									class="row"
									disabled={!item.mediaId}
									onclick={() => item.mediaId && goto(`/${item.mediaType === 'movie' ? 'movie' : 'show'}/${item.source}/${item.mediaId}`)}
								>
									<Poster src={item.poster} width={54} height={81} />
									<span class="meta">
										<span class="title">{item.title}</span>
										{#if item.season !== null && item.episode !== null}
											<span class="ep tnum">{epLabel(item.season, item.episode)}</span>
										{/if}
										<!-- Absolute datetime, which Hobi omits (§5.2) — but only
										     when Floppy actually knows the time. -->
										<!-- Always format the real instant. Slicing to a date-only
										     string would re-parse as UTC midnight and show the
										     previous day west of Greenwich. -->
										<span class="when tnum">{formatAirDate(item.start, { withTime: item.hasTime })}</span>
									</span>
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
			<p class="count tnum">{upcomingCount} upcoming</p>
			{/if}
		{:catch err}
			{@const missing = notLinkedOf(err)}
			{#if missing}
				<NotLinked service={missing} />
			{:else}
			<div class="empty">
				<h2>Can't load the calendar</h2>
				<p>{err.message}</p>
			</div>
			{/if}
		{/await}
	</main>

	<TabBar current="upcoming" />
</div>

<style>
	/* Frame from the global `.app` shell (app.css). */
	/* Already-aired days sit above Today; muted so the eye lands on what's next. */
	section.past {
		opacity: 0.6;
	}
	h1 {
		margin: 0;
		font-size: 26px;
		font-weight: 700;
		letter-spacing: -0.02em;
	}
	main {
		padding: 4px var(--gutter) calc(var(--tabbar-footprint) + 24px);
	}

	.skdays { display: flex; flex-direction: column; gap: 8px; }

	.day {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin: 18px 0 8px;
	}
	.label {
		font-size: 13px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.rel {
		font-size: 12px;
		color: var(--text-dim);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: 18px 1fr;
		gap: 10px;
	}

	.rail {
		position: relative;
		display: block;
		justify-self: center;
		width: 2px;
		background: var(--signal);
		opacity: 0.55;
	}
	li:first-child .rail {
		border-radius: 1px 1px 0 0;
		margin-top: 8px;
	}
	li:last-child .rail {
		border-radius: 0 0 1px 1px;
		margin-bottom: 8px;
	}
	.node {
		position: absolute;
		top: 32px;
		left: 50%;
		width: 9px;
		height: 9px;
		margin-left: -4.5px;
		border-radius: 50%;
		background: var(--signal-to);
		box-shadow: 0 0 0 3px var(--bg);
	}

	.row {
		display: grid;
		grid-template-columns: 54px 1fr;
		gap: 12px;
		align-items: center;
		width: 100%;
		padding: 6px 0;
		text-align: left;
		min-width: 0;
	}
	.row:disabled {
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
	.ep {
		font-size: 13px;
		color: var(--text-dim);
	}
	.when {
		font-size: 12px;
		color: var(--signal-solid);
	}

	.empty {
		margin-top: 22vh;
		text-align: center;
	}
	.empty h2 {
		margin: 0 0 8px;
		font-size: 17px;
	}
	.empty p {
		margin: 0;
		font-size: 14px;
		color: var(--text-dim);
	}

	.count {
		margin: 24px 0 0;
		text-align: center;
		font-size: 12px;
		color: var(--text-dim);
	}
</style>
