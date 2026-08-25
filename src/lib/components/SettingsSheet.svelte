<script lang="ts">
	import Sheet from './Sheet.svelte';
	import type { MarkDirection, Prefs } from '$lib/server/prefs';

	/** Preferences live server-side in /data (§8), so this edits them through the
	 *  API rather than localStorage — the same values drive the server render. */
	type Props = {
		prefs: Prefs;
		/** Services seen across the library, for the subscription picker (§6.3). */
		allServices?: string[];
		floppyUrl?: string | null;
		onsaved: (p: Prefs) => void;
		onclose: () => void;
	};
	let { prefs, allServices = [], floppyUrl = null, onsaved, onclose }: Props = $props();

	/* Optimistic edit layered over the prop, so a save that fails simply reverts
	   by clearing it. */
	let edited = $state<Prefs | null>(null);
	const local = $derived(edited ?? prefs);

	/* Same reason as the filter sheet: the library spans ~29 services, and an
	   undifferentiated wall of chips buries everything below it. Selected ones
	   stay pinned so you can always see and unpick what you chose. */
	let serviceQuery = $state('');
	const visibleServices = $derived.by(() => {
		const q = serviceQuery.trim().toLowerCase();
		const matched = q ? allServices.filter((s) => s.toLowerCase().includes(q)) : allServices;
		return [
			...matched.filter((s) => local.services.includes(s)),
			...matched.filter((s) => !local.services.includes(s))
		].slice(0, q ? 20 : 10);
	});
	let failed = $state<string | null>(null);

	const DIRECTIONS: { id: MarkDirection; label: string; hint: string }[] = [
		{ id: 'rtl', label: 'Right to left', hint: 'Swipe leftward across the row' },
		{ id: 'ltr', label: 'Left to right', hint: 'Swipe rightward across the row' }
	];

	async function patch(change: Partial<Prefs>) {
		const before = edited;
		edited = { ...local, ...change };
		try {
			const res = await fetch('/api/prefs', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(change)
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const next = (await res.json()) as Prefs;
			edited = next;
			onsaved(next);
			failed = null;
		} catch (err) {
			edited = before;
			failed = `Couldn't save — ${err instanceof Error ? err.message : err}`;
		}
	}
</script>

<Sheet label="Settings" {onclose} scrollable>
	<div class="pad">
		<h2>Settings</h2>

		<section>
			<h3>Swipe to mark watched</h3>
			<div class="choices">
				{#each DIRECTIONS as opt (opt.id)}
					<button
						class:selected={local.markDirection === opt.id}
						aria-pressed={local.markDirection === opt.id}
						onclick={() => patch({ markDirection: opt.id })}
					>
						<span class="label">{opt.label}</span>
						<span class="hint">{opt.hint}</span>
					</button>
				{/each}
			</div>
		</section>

		<section>
			<h3>Default tab</h3>
			<div class="chips">
				{#each [{ id: 'watchlist', label: 'Watchlist' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'discover', label: 'Discover' }, { id: 'profile', label: 'Profile' }] as tab (tab.id)}
					<button
						class:on={local.defaultTab === tab.id}
						onclick={() => patch({ defaultTab: tab.id as Prefs['defaultTab'] })}
					>{tab.label}</button>
				{/each}
			</div>
		</section>

		<section>
			<h3>Theme</h3>
			<div class="chips">
				<!-- §10 ships Midnight only, but the tokens are swappable, so the
				     control exists rather than being retrofitted later. -->
				<button class="on">Midnight</button>
				<button disabled>More soon</button>
			</div>
		</section>

		{#if allServices.length}
			<section>
				<h3>Your streaming services</h3>
				<p class="hint">Picked here, these are offered first when filtering.</p>
				<input
					bind:value={serviceQuery}
					type="search"
					placeholder="Search {allServices.length} services"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
				/>
				<div class="chips wrap">
					{#each visibleServices as name (name)}
						<button
							class:on={local.services.includes(name)}
							onclick={() =>
								patch({
									services: local.services.includes(name)
										? local.services.filter((s) => s !== name)
										: [...local.services, name]
								})}
						>{name}</button>
					{/each}
				</div>
			</section>
		{/if}

		<section>
			<h3>Show page</h3>
			<button
				class="row"
				role="switch"
				aria-checked={local.seasonArtwork}
				onclick={() => patch({ seasonArtwork: !local.seasonArtwork })}
			>
				<span class="rowtext">
					<span class="label">Season artwork</span>
					<span class="hint">Most shows reuse the same poster for every season</span>
				</span>
				<span class="toggle" class:on={local.seasonArtwork}><span class="knob"></span></span>
			</button>
		</section>

		{#if failed}<p class="error">{failed}</p>{/if}

		<section>
			<h3>Floppy</h3>
			{#if floppyUrl}
				<a class="out" href={floppyUrl} target="_blank" rel="noreferrer">
					<span class="rowtext">
						<span class="label">Floppy settings</span>
						<span class="hint">Notifications and integrations live there (§9)</span>
					</span>
					<span class="chev">↗</span>
				</a>
			{:else}
				<p class="hint">
					Set <code>FLOPPY_PUBLIC_URL</code> to link out to Floppy's own settings — notifications
					are configured there, not here.
				</p>
			{/if}
		</section>
	</div>
</Sheet>

<style>
	.pad { padding: 0 var(--gutter); }
	h2 { margin: 0 0 18px; font-size: 18px; font-weight: 600; }
	h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--text-dim); }
	section { margin-bottom: 18px; }

	.choices { display: flex; flex-direction: column; gap: 6px; }
	.choices button {
		display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
		min-height: var(--tap); padding: 9px 14px;
		border-radius: var(--radius); background: var(--surface-raised); text-align: left;
	}
	.choices button.selected { background: var(--signal); color: #fff; }

	.row {
		display: flex; align-items: center; justify-content: space-between; gap: 14px;
		width: 100%; min-height: var(--tap); padding: 9px 14px;
		border-radius: var(--radius); background: var(--surface-raised); text-align: left;
	}
	.rowtext { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.label { font-size: 15px; font-weight: 600; }
	.hint { font-size: 12px; opacity: 0.7; }

	.toggle {
		flex: none; width: 46px; height: 28px; padding: 3px;
		border-radius: 14px; background: var(--bg);
		transition: background 160ms ease;
	}
	.toggle.on { background: var(--signal); }
	.knob {
		display: block; width: 22px; height: 22px; border-radius: 50%;
		background: var(--text); transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.toggle.on .knob { transform: translateX(18px); background: #fff; }

	.chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
	.chips.wrap { flex-wrap: wrap; overflow: visible; }
	.chips button {
		flex: none; min-height: 36px; padding: 0 13px; border-radius: 9px;
		background: var(--surface-raised); font-size: 13px; font-weight: 600; color: var(--text-dim);
	}
	.chips button.on { background: var(--signal); color: #fff; }
	.chips button:disabled { opacity: 0.4; }

	.out {
		display: flex; align-items: center; justify-content: space-between; gap: 14px;
		min-height: var(--tap); padding: 9px 14px;
		border-radius: var(--radius); background: var(--surface-raised);
	}
	.chev { color: var(--text-dim); font-size: 16px; }
	code { padding: 1px 5px; border-radius: 5px; background: var(--surface-raised); font-size: 11.5px; }

	input {
		width: 100%; height: 40px; padding: 0 12px; margin-bottom: 8px;
		border: none; border-radius: var(--radius);
		background: var(--surface-raised); color: var(--text);
		font: inherit; font-size: 16px; outline: none;
		-webkit-appearance: none; appearance: none;
	}
	input::-webkit-search-cancel-button { display: none; }

	.error { margin: 0 0 12px; font-size: 13px; color: #ff8a8a; }
</style>
