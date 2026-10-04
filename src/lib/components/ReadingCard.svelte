<script lang="ts">
	import type { ReadingGoal } from '$lib/server/books/shelf';

	/** Profile → Reading, below the range numbers: this year's goal, from your
	 *  Hardcover account. Always the current year, whatever range is picked
	 *  above (the header says so, so the two never read as the same number). */
	let { goal }: { goal: ReadingGoal } = $props();
	const pct = $derived(`${Math.min(100, Math.round((goal.completedBooks / Math.max(1, goal.goalBooks)) * 100))}%`);
</script>

<section class="reading">
	<div class="head">
		<h2>{goal.year} goal</h2>
		<span class="src">From Hardcover</span>
	</div>
	{#if goal.goalBooks > 0}
		<div class="goal">
			<span class="goaltext">
				<span class="label tnum">{goal.completedBooks} of {goal.goalBooks} books</span>
				<span class="hint tnum">{pct}</span>
			</span>
			<span class="track"><span class="fill" style:width={pct}></span></span>
		</div>
	{:else}
		<p class="hint none">
			{goal.completedBooks} book{goal.completedBooks === 1 ? '' : 's'} finished this year. Set a goal from Watchlist → Books.
		</p>
	{/if}
</section>

<style>
	.reading { margin: 0 0 22px; }
	.head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
	h2 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
	.src { font-size: 12px; color: var(--text-dim); }
	.goal { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 14px; background: var(--surface); }
	.goaltext { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
	.label { font-size: 14px; font-weight: 600; }
	.hint { font-size: 12px; color: var(--text-dim); }
	.none { margin: 0; font-size: 13px; }
	.track { height: 6px; border-radius: 3px; background: var(--surface-raised); overflow: hidden; }
	.fill { display: block; height: 100%; border-radius: 3px; background: var(--signal); }
</style>
