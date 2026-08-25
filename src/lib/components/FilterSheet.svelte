<script lang="ts">
	import Sheet from './Sheet.svelte';
	import type { Company } from '$lib/server/tags';

	export type Filters = { status: string; company: Company; services: string[] };

	type Props = {
		filters: Filters;
		/** Every service seen in the library, commonest first. */
		allServices: string[];
		/** Services the household subscribes to (§8); offered first when set. */
		subscribed: string[];
		onchange: (f: Filters) => void;
		onclose: () => void;
	};
	let { filters, allServices, subscribed, onchange, onclose }: Props = $props();

	const STATUSES = [
		{ id: 'in_progress', label: 'In progress' },
		{ id: 'planning', label: 'Planning' },
		{ id: 'completed', label: 'Completed' },
		{ id: 'paused', label: 'Paused' },
		{ id: 'dropped', label: 'Dropped' },
		{ id: 'all', label: 'All' }
	];

	const COMPANY: { id: Company; label: string }[] = [
		{ id: 'all', label: 'All' },
		{ id: 'joint', label: 'Joint' },
		{ id: 'solo', label: 'Solo' }
	];

	/* Subscribed services first — that is the list the household actually cares
	   about — then everything else the library has seen. */
	const services = $derived([
		...subscribed.filter((s) => allServices.includes(s)),
		...allServices.filter((s) => !subscribed.includes(s))
	]);

	const toggleService = (name: string) =>
		onchange({
			...filters,
			services: filters.services.includes(name)
				? filters.services.filter((s) => s !== name)
				: [...filters.services, name]
		});

	const active = $derived(
		filters.status !== 'in_progress' || filters.company !== 'all' || filters.services.length > 0
	);
</script>

<Sheet label="Filter" {onclose} scrollable>
	<div class="pad">
		<div class="head">
			<h2>Filter</h2>
			{#if active}
				<button class="reset" onclick={() => onchange({ status: 'in_progress', company: 'all', services: [] })}>
					Reset
				</button>
			{/if}
		</div>

		<section>
			<h3>Status</h3>
			<div class="chips">
				{#each STATUSES as s (s.id)}
					<button class:on={filters.status === s.id} onclick={() => onchange({ ...filters, status: s.id })}>
						{s.label}
					</button>
				{/each}
			</div>
		</section>

		<section>
			<h3>Watching with</h3>
			<p class="hint">Shows tagged <code>joint</code> in Floppy are the ones you watch together.</p>
			<div class="chips">
				{#each COMPANY as c (c.id)}
					<button class:on={filters.company === c.id} onclick={() => onchange({ ...filters, company: c.id })}>
						{c.label}
					</button>
				{/each}
			</div>
		</section>

		{#if services.length}
			<section>
				<h3>Streaming service</h3>
				<div class="chips wrap">
					{#each services as name (name)}
						<button class:on={filters.services.includes(name)} onclick={() => toggleService(name)}>
							{name}
						</button>
					{/each}
				</div>
			</section>
		{/if}
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter); }
	.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
	h2 { margin: 0; font-size: 18px; font-weight: 600; }
	.reset { font-size: 13px; font-weight: 600; color: var(--signal-solid); }

	section { margin-bottom: 20px; }
	h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
	.hint { margin: -4px 0 8px; font-size: 12px; line-height: 1.45; color: var(--text-dim); }
	code { padding: 1px 5px; border-radius: 5px; background: var(--surface-raised); font-size: 11.5px; }

	.chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
	.chips.wrap { flex-wrap: wrap; overflow: visible; }
	.chips button {
		flex: none; min-height: 36px; padding: 0 13px; border-radius: 9px;
		background: var(--surface-raised); font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.chips button.on { background: var(--signal); color: #fff; }
</style>
