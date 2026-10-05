<script lang="ts">
	import { untrack } from 'svelte';
	import Sheet from './Sheet.svelte';
	import type { GoalFormat, GoalMetric, ReadingGoalItem } from '$lib/books';

	/** Create or change a reading goal — the same choices as Hardcover's own
	 *  editor. Goals are always private. `onsaved` gets the fresh list. */
	type Props = {
		goal?: ReadingGoalItem | null;
		onclose: () => void;
		onsaved: (goals: ReadingGoalItem[]) => void;
	};
	let { goal = null, onclose, onsaved }: Props = $props();

	const year = new Date().getFullYear();
	// The form starts from the goal as it was when the sheet opened.
	const from = untrack(() => goal);
	let title = $state(from?.title ?? `${year} Reading Goal`);
	let format = $state<GoalFormat>(from?.format ?? 'any');
	let target = $state(String(from?.target ?? 12));
	let metric = $state<GoalMetric>(from?.metric ?? 'book');
	let startDate = $state(from?.startDate ?? `${year}-01-01`);
	let endDate = $state(from?.endDate ?? `${year}-12-31`);
	let busy = $state(false);
	let failed = $state<string | null>(null);
	let confirmDelete = $state(false);

	const FORMATS: { id: GoalFormat; label: string }[] = [
		{ id: 'any', label: 'Read or listen to' },
		{ id: 'read', label: 'Read' },
		{ id: 'listen', label: 'Listen to' }
	];
	const METRICS: { id: GoalMetric; label: string }[] = [
		{ id: 'book', label: 'Books' },
		{ id: 'page', label: 'Pages' },
		{ id: 'hour', label: 'Hours' }
	];

	async function send(method: 'PUT' | 'DELETE', body: unknown) {
		busy = true;
		failed = null;
		try {
			const res = await fetch('/api/books/goals', {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out.message ?? `HTTP ${res.status}`);
			return out;
		} catch (e) {
			failed = (e as Error).message;
			return null;
		} finally {
			busy = false;
		}
	}

	async function save() {
		const out = await send('PUT', { id: goal?.id ?? null, title, format, target: Number(target), metric, startDate, endDate });
		if (out) {
			onsaved(out.goals ?? []);
			onclose();
		}
	}

	async function remove() {
		if (!goal) return;
		if (!confirmDelete) {
			confirmDelete = true;
			return;
		}
		const out = await send('DELETE', { id: goal.id });
		if (out) {
			onsaved([]);
			onclose();
		}
	}
</script>

<Sheet label={goal ? 'Edit goal' : 'New goal'} scrollable {onclose}>
	<form class="body" onsubmit={(e) => (e.preventDefault(), void save())}>
		<h2>{goal ? 'Edit goal' : 'New goal'}</h2>
		<p class="hint">Only books with a finish date between these days count. Private on Hardcover.</p>

		<label class="field">
			<span class="flabel">Title</span>
			<input bind:value={title} maxlength="120" />
		</label>

		<div class="field">
			<span class="flabel">I want to</span>
			<div class="chips">
				{#each FORMATS as f (f.id)}
					<button type="button" class:on={format === f.id} onclick={() => (format = f.id)}>{f.label}</button>
				{/each}
			</div>
		</div>

		<div class="field">
			<span class="flabel">How much</span>
			<div class="amount">
				<input type="number" inputmode="numeric" min="1" bind:value={target} aria-label="Target" />
				<div class="chips">
					{#each METRICS as m (m.id)}
						<button type="button" class:on={metric === m.id} onclick={() => (metric = m.id)}>{m.label}</button>
					{/each}
				</div>
			</div>
		</div>

		<div class="dates">
			<label class="field">
				<span class="flabel">From</span>
				<input type="date" bind:value={startDate} />
			</label>
			<label class="field">
				<span class="flabel">To</span>
				<input type="date" bind:value={endDate} min={startDate} />
			</label>
		</div>

		{#if failed}<p class="err">{failed}</p>{/if}

		<button type="submit" class="submit" disabled={busy}>{busy ? 'Saving…' : goal ? 'Save goal' : 'Create goal'}</button>
		{#if goal}
			<button type="button" class="delete" disabled={busy} onclick={remove}>
				{confirmDelete ? 'Tap again to delete this goal' : 'Delete goal'}
			</button>
		{/if}
	</form>
</Sheet>

<style>
	.body { display: flex; flex-direction: column; gap: 14px; padding: 4px 16px 16px; }
	h2 { margin: 0; font-size: 19px; font-weight: 700; }
	.hint { margin: -8px 0 0; font-size: 13px; line-height: 1.4; color: var(--text-dim); }
	.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
	.flabel { font-size: 13px; font-weight: 600; color: var(--text-dim); }
	input {
		width: 100%; min-height: var(--tap); padding: 0 12px; border: none; border-radius: 12px;
		background: var(--surface-raised); color: var(--text); font: inherit; font-size: 16px;
	}
	.chips { display: flex; flex-wrap: wrap; gap: 6px; }
	.chips button {
		min-height: 36px; padding: 0 12px; border-radius: 10px; background: var(--surface-raised);
		font-size: 14px; font-weight: 600; color: var(--text-dim);
	}
	.chips button.on { background: var(--signal); color: #fff; }
	.amount { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
	.amount input { width: 96px; flex: none; }
	.dates { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
	.err { margin: 0; font-size: 13px; color: #ff8a8a; }
	.submit { min-height: var(--tap); border-radius: 14px; background: var(--signal); color: #fff; font-size: 16px; font-weight: 600; }
	.submit:disabled, .delete:disabled { opacity: 0.6; }
	.delete { min-height: 40px; font-size: 14px; font-weight: 600; color: #ff8a8a; }
</style>
