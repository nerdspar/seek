<script lang="ts">
	import GoalSheet from './GoalSheet.svelte';
	import { goalProgressText, type ReadingGoalItem } from '$lib/books';

	/** Profile → Reading, below the range numbers: your reading goals on
	 *  Hardcover — every one still running, with Hardcover's count. Tap one to
	 *  change it; add as many as you like. */
	let { goals: initial }: { goals: ReadingGoalItem[] } = $props();
	let goals = $state<ReadingGoalItem[] | null>(null);
	const shown = $derived(goals ?? initial);
	let editing = $state<ReadingGoalItem | null | 'new'>(null);

	const pct = (g: ReadingGoalItem) => `${Math.min(100, Math.round((g.done / Math.max(1, g.target)) * 100))}%`;
	const span = (g: ReadingGoalItem) => {
		const f = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
		const y = g.startDate.slice(0, 4);
		return g.startDate === `${y}-01-01` && g.endDate === `${y}-12-31` ? y : `${f(g.startDate)} – ${f(g.endDate)}`;
	};
	const FORMAT: Record<ReadingGoalItem['format'], string> = { any: '', read: ' · reading', listen: ' · listening' };

	async function refresh(saved: ReadingGoalItem[]) {
		// A delete returns nothing; ask for the list again.
		if (saved.length) goals = saved;
		else goals = await fetch('/api/books/goals').then((r) => (r.ok ? r.json() : { goals: shown })).then((d) => d.goals);
	}
</script>

<section class="reading">
	<div class="head">
		<h2>Goals</h2>
		<span class="src">From Hardcover</span>
	</div>
	<ul>
		{#each shown as g (g.id)}
			<li>
				<button class="goal" onclick={() => (editing = g)}>
					<span class="goaltext">
						<span class="label">{g.title}</span>
						<span class="hint tnum">{span(g)}{FORMAT[g.format]}</span>
					</span>
					<span class="track"><span class="fill" style:width={pct(g)}></span></span>
					<span class="count tnum">{goalProgressText(g)} · {pct(g)}</span>
				</button>
			</li>
		{/each}
	</ul>
	<button class="add" onclick={() => (editing = 'new')}>+ New goal</button>
</section>

{#if editing}
	<GoalSheet goal={editing === 'new' ? null : editing} onclose={() => (editing = null)} onsaved={refresh} />
{/if}

<style>
	.reading { margin: 0 0 22px; }
	.head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
	h2 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
	.src { font-size: 12px; color: var(--text-dim); }
	ul { margin: 0 0 8px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
	.goal { display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 12px 14px; border-radius: 14px; background: var(--surface); text-align: left; }
	.goaltext { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
	.label { font-size: 14px; font-weight: 600; }
	.hint, .count { font-size: 12px; color: var(--text-dim); }
	.track { height: 6px; border-radius: 3px; background: var(--surface-raised); overflow: hidden; }
	.fill { display: block; height: 100%; border-radius: 3px; background: var(--signal); }
	.add { font-size: 14px; font-weight: 600; color: var(--signal-solid); padding: 6px 0; }
</style>
