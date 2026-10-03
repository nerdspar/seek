<script lang="ts">
	import type { ReadingSnapshot } from '$lib/server/books/bookorbit';

	/** Profile → Reading, below the range numbers: this year's goal and the
	 *  habits BookOrbit tracks — streak, the month's challenge, achievements.
	 *  Always the current year, whatever range is picked above (that's what the
	 *  header says, so the two never read as the same number). */
	let { snap }: { snap: ReadingSnapshot } = $props();

	const goal = $derived(snap.goal && snap.goal.goalBooks > 0 ? snap.goal : null);
	const pctOf = (a: number, b: number) => `${Math.min(100, Math.round((a / Math.max(1, b)) * 100))}%`;
	const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
	const week = $derived(snap.streak?.lastSevenDays ?? []);
	// Label the seven dots by weekday, ending today.
	const labels = $derived(
		week.map((_, i) => {
			const d = new Date();
			d.setDate(d.getDate() - (week.length - 1 - i));
			return DAYS[(d.getDay() + 6) % 7];
		})
	);
</script>

<section class="reading">
	<div class="head">
		<h2>{new Date().getFullYear()} goal & streaks</h2>
		<span class="src">From BookOrbit</span>
	</div>

	{#if goal}
		<div class="goal">
			<span class="goaltext">
				<span class="label tnum">{goal.completedBooks} of {goal.goalBooks} books</span>
				<span class="hint">{goal.year} goal</span>
			</span>
			<span class="track"><span class="fill" style:width={pctOf(goal.completedBooks, goal.goalBooks)}></span></span>
		</div>
	{/if}

	<ul class="tiles">
		<li><span class="n tnum">{snap.streak?.current ?? '—'}</span><span class="l">Day streak</span></li>
		<li><span class="n tnum">{snap.streak?.longest ?? '—'}</span><span class="l">Longest streak</span></li>
	</ul>

	{#if week.length}
		<div class="week" aria-label="Days you read this week">
			{#each week as read, i (i)}
				<span class="day"><span class="dot" class:on={read}></span><span class="dl">{labels[i]}</span></span>
			{/each}
		</div>
	{/if}

	{#if snap.challenge}
		<div class="row">
			<span class="rowtext">
				<span class="label">{snap.challenge.title}{snap.challenge.completed ? ' ✓' : ''}</span>
				<span class="hint">{snap.challenge.description}</span>
			</span>
			<span class="count tnum">{snap.challenge.progress}/{snap.challenge.target}</span>
		</div>
	{/if}

	{#if snap.achievements}
		<div class="row">
			<span class="rowtext">
				<span class="label">Achievements</span>
				<span class="hint">
					{#if snap.achievements.recent.length}
						Latest: {snap.achievements.recent.map((a) => a.name).join(', ')}
					{:else}
						Finish a book to earn your first
					{/if}
				</span>
			</span>
			<span class="count tnum">{snap.achievements.earned}/{snap.achievements.available}</span>
		</div>
	{/if}
</section>

<style>
	.reading { margin: 0 0 22px; }
	.head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
	h2 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
	.src { font-size: 12px; color: var(--text-dim); }

	.goal {
		display: flex; flex-direction: column; gap: 8px;
		margin-bottom: 10px; padding: 12px 14px; border-radius: 14px; background: var(--surface);
	}
	.goaltext { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
	.track { height: 6px; border-radius: 3px; background: var(--surface-raised); overflow: hidden; }
	.fill { display: block; height: 100%; border-radius: 3px; background: var(--signal); }

	.tiles { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin: 0 0 10px; padding: 0; list-style: none; }
	.tiles li {
		display: flex; flex-direction: column; align-items: center; gap: 2px;
		padding: 12px 4px; border-radius: 14px; background: var(--surface);
	}
	.n { font-size: 20px; font-weight: 700; }
	.l { font-size: 11px; color: var(--text-dim); }

	.week { display: flex; justify-content: space-between; margin: 0 0 10px; padding: 10px 14px; border-radius: 14px; background: var(--surface); }
	.day { display: flex; flex-direction: column; align-items: center; gap: 4px; }
	.dot { width: 12px; height: 12px; border-radius: 50%; background: var(--surface-raised); }
	.dot.on { background: var(--signal); }
	.dl { font-size: 10.5px; color: var(--text-dim); }

	.row {
		display: flex; align-items: center; justify-content: space-between; gap: 12px;
		margin-bottom: 8px; padding: 10px 14px; border-radius: 14px; background: var(--surface);
	}
	.rowtext { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.label { font-size: 14px; font-weight: 600; }
	.hint { font-size: 12px; color: var(--text-dim); }
	.count { flex: none; font-size: 14px; font-weight: 650; color: var(--text-dim); }
</style>
