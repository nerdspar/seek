<script lang="ts">
	import { goto } from '$app/navigation';
	import Poster from '$lib/components/Poster.svelte';
	import TabBar from '$lib/components/TabBar.svelte';
	import SettingsSheet from '$lib/components/SettingsSheet.svelte';
	import { load as loadSettings, save as saveSettings, type MarkDirection, type Settings } from '$lib/settings';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let settings = $state<Settings>({ markDirection: 'rtl' });
	let settingsOpen = $state(false);
	$effect(() => {
		settings = loadSettings();
	});

	function setDirection(markDirection: MarkDirection) {
		settings = { ...settings, markDirection };
		saveSettings(settings);
	}

	const RANGES = [
		{ id: 'this_month', label: 'This month' },
		{ id: 'this_year', label: 'This year' },
		{ id: 'last_year', label: 'Last year' },
		{ id: 'all_time', label: 'All time' }
	];

	const fmt = (n: number) => n.toLocaleString();
	const peakOf = (weekday: { hours: number }[]) => Math.max(1, ...weekday.map((d) => d.hours));
</script>

<div class="app">
	<header>
		<div class="titlerow">
			<h1>Profile</h1>
			<div class="actions">
			<button class="gear" onclick={() => goto('/profile/diary')} aria-label="Diary">
				<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
					<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z" />
					<path d="M8 3v18M11.5 8.5h4M11.5 12h4" />
				</svg>
			</button>
			<button class="gear" onclick={() => (settingsOpen = true)} aria-label="Settings">
				<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7">
					<circle cx="12" cy="12" r="3.1" />
					<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
				</svg>
			</button>
			</div>
		</div>
		<div class="chips">
			{#each RANGES as r (r.id)}
				<button
					class:on={data.range === r.id}
					onclick={() => goto(`/profile?range=${r.id}`, { noScroll: true })}
				>{r.label}</button>
			{/each}
		</div>
	</header>

	<main>
		{#await data.stats}
			<!-- The shell is already on screen; only the numbers are pending. -->
			<div class="loading">
				<div class="sk headline"></div>
				<div class="sk tiles"></div>
				<div class="sk block"></div>
			</div>
		{:then stats}
			<!-- stats is non-null here: the load rejects rather than resolving null. -->
				<!-- §7.1: every number below is read from Floppy's overview endpoint.
				     Seek computes nothing except the date window. -->
				<section class="headline">
					<span class="big tnum">{fmt(stats.hours)}</span>
					<span class="unit">hours logged · {stats.rangeLabel}</span>
				</section>

				<ul class="tiles">
					<li><span class="n tnum">{fmt(stats.plays)}</span><span class="l">Plays</span></li>
					<li><span class="n tnum">{fmt(stats.counts.tv)}</span><span class="l">Shows</span></li>
					<li><span class="n tnum">{fmt(stats.counts.movie)}</span><span class="l">Movies</span></li>
					<li><span class="n tnum">{fmt(stats.completed)}</span><span class="l">Completed</span></li>
				</ul>

				{#if stats.weekday.length}
					<section>
						<h2>Binge rhythm</h2>
						{#if stats.mostActiveDay}
							<p class="sub">
								{stats.mostActiveDay} is your heaviest day{stats.mostActiveDayPct ? ` — ${stats.mostActiveDayPct}% of everything` : ''}.
							</p>
						{/if}
						<div class="bars">
							{#each stats.weekday as d (d.label)}
								<div class="bar">
									<div class="col"><div class="fill" style:height={`${Math.max(2, (d.hours / peakOf(stats.weekday)) * 100)}%`}></div></div>
									<span class="lab">{d.label}</span>
								</div>
							{/each}
						</div>
					</section>
				{/if}

				<section class="streaks">
					<div><span class="n tnum">{stats.currentStreak}</span><span class="l">Current streak</span></div>
					<div><span class="n tnum">{stats.longestStreak}</span><span class="l">Longest streak</span></div>
				</section>

				{#if stats.topTitles.length}
					<section>
						<h2>Most watched</h2>
						<ul class="rail">
							{#each stats.topTitles as t (t.mediaId)}
								<li>
									<button onclick={() => goto(`/show/${t.source}/${t.mediaId}`)}>
										<Poster src={t.poster} width={92} height={138} radius={9} />
										<span class="cap">{t.title}</span>
										<span class="sub2 tnum">{t.duration}</span>
									</button>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if stats.topGenres.length}
					<section>
						<h2>Favourite genres</h2>
						<ul class="list">
							{#each stats.topGenres as g (g.name)}
								<li><span>{g.name}</span><span class="dim tnum">{g.duration}</span></li>
							{/each}
						</ul>
					</section>
				{/if}

				{#if stats.topStudios.length}
					<section>
						<h2>Top networks</h2>
						<ul class="list">
							{#each stats.topStudios as s (s.name)}
								<li><span>{s.name}</span><span class="dim tnum">{s.watched}</span></li>
							{/each}
						</ul>
					</section>
				{/if}

		{:catch err}
			<div class="empty"><h2>Can't load stats</h2><p>{err.message}</p></div>
		{/await}
	</main>

	<TabBar current="profile" />

	{#if settingsOpen}
		<SettingsSheet
			markDirection={settings.markDirection}
			onchange={setDirection}
			onclose={() => (settingsOpen = false)}
		/>
	{/if}
</div>

<style>
	.app { min-height: 100dvh; padding-top: var(--header-top); }
	header { padding: 10px var(--gutter) 4px; }
	.titlerow {
		display: flex; align-items: center; justify-content: space-between; gap: 12px;
		margin-bottom: 10px;
	}
	h1 { margin: 0; font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
	.actions { display: flex; align-items: center; gap: 2px; margin-right: -10px; }
	.gear {
		flex: none; display: grid; place-items: center;
		width: var(--tap); height: var(--tap);
		border-radius: 50%; color: var(--text-dim);
	}

	.chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
	.chips button {
		flex: none; min-height: 32px; padding: 0 12px; border-radius: 9px;
		background: var(--surface); font-size: 12.5px; font-weight: 600; color: var(--text-dim);
	}
	.chips button.on { background: var(--surface-raised); color: var(--text); }

	main { padding: 10px var(--gutter) calc(var(--tabbar-h) + var(--safe-b) + 32px); }

	.headline { display: flex; flex-direction: column; gap: 2px; margin-bottom: 16px; }
	.big {
		font-size: 42px; font-weight: 700; line-height: 1; letter-spacing: -0.03em;
		background: var(--signal); -webkit-background-clip: text; background-clip: text; color: transparent;
	}
	.unit { font-size: 13px; color: var(--text-dim); }

	.tiles, .streaks {
		display: grid; gap: 8px; margin: 0 0 24px; padding: 0; list-style: none;
	}
	.tiles { grid-template-columns: repeat(4, 1fr); }
	.streaks { grid-template-columns: repeat(2, 1fr); }
	.tiles li, .streaks div {
		display: flex; flex-direction: column; gap: 2px; align-items: center;
		padding: 12px 6px; border-radius: var(--radius); background: var(--surface);
	}
	.n { font-size: 19px; font-weight: 700; }
	.l { font-size: 10.5px; color: var(--text-dim); text-align: center; }

	section { margin-bottom: 24px; }
	h2 {
		margin: 0 0 6px; font-size: 12.5px; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-dim);
	}
	.sub { margin: 0 0 12px; font-size: 13px; color: var(--text); }

	.bars { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; height: 110px; }
	.bar { display: flex; flex-direction: column; gap: 6px; }
	.col { flex: 1; display: flex; align-items: flex-end; border-radius: 6px; background: var(--surface); overflow: hidden; }
	.fill { width: 100%; border-radius: 6px; background: var(--signal); }
	.lab { font-size: 10.5px; text-align: center; color: var(--text-dim); }

	.rail { display: flex; gap: 12px; margin: 0; padding: 0 0 4px; list-style: none; overflow-x: auto; }
	.rail li { flex: none; width: 92px; }
	.cap {
		display: -webkit-box; margin-top: 6px; font-size: 12px; font-weight: 600; line-height: 1.3;
		overflow: hidden; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
	}
	.sub2 { display: block; font-size: 11px; color: var(--text-dim); }

	.list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
	.list li {
		display: flex; align-items: center; justify-content: space-between; gap: 12px;
		width: 100%; min-height: var(--tap); padding: 8px 14px;
		border-radius: var(--radius); background: var(--surface); font-size: 14px;
	}
	.dim { color: var(--text-dim); font-size: 12.5px; }

	.loading { display: flex; flex-direction: column; gap: 16px; }
	.sk { border-radius: var(--radius); background: var(--surface); animation: pulse 1.4s ease-in-out infinite; }
	.sk.headline { height: 62px; width: 62%; }
	.sk.tiles { height: 72px; }
	.sk.block { height: 150px; }
	@keyframes pulse { 50% { opacity: 0.55; } }

	.empty { margin-top: 20vh; text-align: center; }
	.empty h2 { margin: 0 0 8px; font-size: 17px; text-transform: none; letter-spacing: 0; color: var(--text); }
	.empty p { margin: 0; font-size: 14px; color: var(--text-dim); }
</style>
