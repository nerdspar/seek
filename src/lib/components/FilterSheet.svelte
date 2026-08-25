<script lang="ts">
	import Sheet from './Sheet.svelte';
	import type { Company } from '$lib/server/tags';

	export type Filters = { status: string; company: Company; services: string[] };

	type Props = {
		filters: Filters;
		/** Services the household subscribes to (§8); offered first when set. */
		subscribed: string[];
		onchange: (f: Filters) => void;
		onclose: () => void;
	};
	let { filters, subscribed, onchange, onclose }: Props = $props();

	/* Fetched here rather than in the page load: building this list pages the
	   whole library, and awaiting it on the watchlist — the launch screen —
	   blocked first paint for 14s on a cold cache. */
	let allServices = $state<string[]>([]);
	$effect(() => {
		fetch('/api/services')
			.then((r) => (r.ok ? r.json() : { services: [] }))
			.then((b) => (allServices = b.services ?? []))
			.catch(() => {});
	});

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
	   about — then everything else the library has seen, commonest first. */
	const ordered = $derived([
		...subscribed.filter((s) => allServices.includes(s)),
		...allServices.filter((s) => !subscribed.includes(s))
	]);

	/* Even collapsed, the library spans ~29 services with a long tail of
	   one-offs. Showing them all as chips buried the two filters above it, so
	   only a handful are offered and the rest are reachable by typing. */
	let serviceQuery = $state('');
	const SHOWN = 6;

	const matches = $derived(
		serviceQuery.trim()
			? ordered.filter((s) => s.toLowerCase().includes(serviceQuery.trim().toLowerCase()))
			: ordered
	);
	// Anything already selected stays visible even when it falls outside the top few.
	const visibleServices = $derived(
		serviceQuery.trim()
			? matches.slice(0, 20)
			: [
					...matches.filter((s) => filters.services.includes(s)),
					...matches.filter((s) => !filters.services.includes(s))
				].slice(0, SHOWN)
	);
	const hiddenCount = $derived(Math.max(0, matches.length - visibleServices.length));

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

		{#if ordered.length}
			<section>
				<h3>Streaming service</h3>
				<input
					bind:value={serviceQuery}
					type="search"
					placeholder="Search {ordered.length} services"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
				/>
				{#if visibleServices.length}
					<div class="chips wrap">
						{#each visibleServices as name (name)}
							<button class:on={filters.services.includes(name)} onclick={() => toggleService(name)}>
								{name}
							</button>
						{/each}
					</div>
					{#if hiddenCount}
						<p class="more tnum">{hiddenCount} more — type to find them</p>
					{/if}
				{:else}
					<p class="more">No service matches “{serviceQuery.trim()}”.</p>
				{/if}
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

	input {
		width: 100%; height: 40px; padding: 0 12px; margin-bottom: 8px;
		border: none; border-radius: var(--radius);
		background: var(--surface-raised); color: var(--text);
		font: inherit; font-size: 16px; outline: none;
		-webkit-appearance: none; appearance: none;
	}
	input::-webkit-search-cancel-button { display: none; }
	.more { margin: 8px 0 0; font-size: 12px; color: var(--text-dim); }

	.chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
	.chips.wrap { flex-wrap: wrap; overflow: visible; }
	.chips button {
		flex: none; min-height: 36px; padding: 0 13px; border-radius: 9px;
		background: var(--surface-raised); font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.chips button.on { background: var(--signal); color: #fff; }
</style>
