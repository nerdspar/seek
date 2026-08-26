<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import type { Accent, Appearance, MarkDirection, Prefs } from '$lib/server/prefs';
	import type { PageData } from './$types';

	/** Preferences live server-side in /data (§8), so this edits them through the
	 *  API rather than localStorage — the same values drive the server render. */
	let { data }: { data: PageData } = $props();
	const prefs = $derived(data.prefs);
	const defaultPresets = $derived(data.defaultPresets ?? []);
	const floppyUrl = $derived(data.floppyUrl ?? null);

	/* Fetched here rather than in the page load: building this list pages the
	   whole library, and awaiting it on Profile blocked that page for 11s on a
	   cold cache for data only this sheet reads. */
	let allServices = $state<string[]>([]);
	$effect(() => {
		fetch('/api/services')
			.then((r) => (r.ok ? r.json() : { services: [] }))
			.then((b) => (allServices = b.services ?? []))
			.catch(() => {});
	});

	/* Optimistic edit layered over the prop, so a save that fails simply reverts
	   by clearing it. */
	let edited = $state<Prefs | null>(null);
	const local = $derived(edited ?? prefs);

	/* Same reason as the filter sheet: the library spans ~29 services, and an
	   undifferentiated wall of chips buries everything below it. Selected ones
	   stay pinned so you can always see and unpick what you chose. */
	/* Editing the chips is a rare, deliberate act, but the list is one row per
	   preset and there are 18 by default — 967px of a 1597px sheet, more than a
	   screenful, pushing everything after it out of sight. It opens on request. */
	let editingPresets = $state(false);

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

	const APPEARANCE_OPTIONS: { id: Appearance; label: string }[] = [
		{ id: 'system', label: 'System' },
		{ id: 'light', label: 'Light' },
		{ id: 'dark', label: 'Dark' }
	];

	/* Swatches are drawn from the same two stops the gradient uses, so the dot is
	   the accent rather than an approximation of it that can drift. */
	const ACCENT_OPTIONS: { id: Accent; label: string; from: string; to: string }[] = [
		{ id: 'violet', label: 'Violet', from: '#5b6cff', to: '#b36bff' },
		{ id: 'sky', label: 'Sky', from: '#0a84ff', to: '#35d6ff' },
		{ id: 'teal', label: 'Teal', from: '#00b3a4', to: '#4fd6b8' },
		{ id: 'ember', label: 'Ember', from: '#ff6b35', to: '#ffb545' },
		{ id: 'rose', label: 'Rose', from: '#ff3d8b', to: '#ff8bc0' }
	];

	/* The tokens live on <html>, which is outside this component and outside
	   Svelte's control, so switching has to reach for it directly. Applied here
	   as well as server-side so the change is instant rather than waiting for a
	   navigation. */
	function applyAppearance(id: Appearance) {
		document.documentElement.dataset.appearance = id;
		patch({ appearance: id });
	}
	function applyAccent(id: Accent) {
		document.documentElement.dataset.accent = id;
		patch({ accent: id });
	}

	const DIRECTIONS: { id: MarkDirection; label: string; hint: string }[] = [
		{ id: 'rtl', label: 'Right to left', hint: 'Swipe leftward across the row' },
		{ id: 'ltr', label: 'Left to right', hint: 'Swipe rightward across the row' }
	];

	/* ── Discover mood chips ───────────────────────────────────────────────
	   Stored as labels. A new one is checked against TMDB's keyword search
	   before being saved — a chip that resolves to nothing would just render an
	   empty result set with no explanation. */
	const presets = $derived(local.moodPresets ?? defaultPresets);

	let newPreset = $state('');
	let presetBusy = $state(false);
	let presetError = $state<string | null>(null);

	function movePreset(index: number, delta: number) {
		const next = [...presets];
		const to = index + delta;
		if (to < 0 || to >= next.length) return;
		[next[index], next[to]] = [next[to], next[index]];
		patch({ moodPresets: next });
	}

	const removePreset = (label: string) =>
		patch({ moodPresets: presets.filter((p) => p !== label) });

	async function addPreset() {
		const label = newPreset.trim();
		if (!label || presetBusy) return;
		if (presets.some((p) => p.toLowerCase() === label.toLowerCase())) {
			presetError = `“${label}” is already there.`;
			return;
		}

		presetBusy = true;
		presetError = null;
		try {
			const res = await fetch(`/api/mood?preset=${encodeURIComponent(label)}&type=tv`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = await res.json();
			if (!body.keywords?.length) {
				presetError = `TMDB has no keyword for “${label}”. Try a different word.`;
				return;
			}
			await patch({ moodPresets: [...presets, label] });
			newPreset = '';
		} catch (err) {
			presetError = `Couldn't check that — ${err instanceof Error ? err.message : err}`;
		} finally {
			presetBusy = false;
		}
	}

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
			failed = null;
		} catch (err) {
			edited = before;
			failed = `Couldn't save — ${err instanceof Error ? err.message : err}`;
		}
	}
</script>

<PageHeader title="Settings" onback={() => goto('/profile')} />

<main>

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
		<h3>Appearance</h3>
		<div class="chips">
			{#each APPEARANCE_OPTIONS as opt (opt.id)}
				<button
					class:on={local.appearance === opt.id}
					onclick={() => applyAppearance(opt.id)}
				>{opt.label}</button>
			{/each}
		</div>
		{#if local.appearance === 'system'}
			<p class="hint">Follows your phone, including when it switches at sunset.</p>
		{/if}
	</section>

	<section>
		<h3>Accent</h3>
		<div class="chips">
			{#each ACCENT_OPTIONS as opt (opt.id)}
				<button
					class="accent"
					class:on={local.accent === opt.id}
					aria-label={opt.label}
					onclick={() => applyAccent(opt.id)}
				>
					<span
						class="swatch"
						style="background: linear-gradient(100deg, {opt.from}, {opt.to})"
					></span>
					{opt.label}
				</button>
			{/each}
		</div>
	</section>

	{#if allServices.length}
		<section>
			<h3>Your streaming services</h3>
			<p class="hint">
				Sorts the ones you have to the front — in Discover's service row, and in the
				watchlist's service filter. Nothing is hidden either way.
			</p>
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
		<div class="sechead">
			<h3>Discover chips</h3>
			<button class="disclose" onclick={() => (editingPresets = !editingPresets)}>
				{editingPresets ? 'Done' : 'Edit'}
			</button>
		</div>
		<p class="hint">
			{presets.length} mood shortcut{presets.length === 1 ? '' : 's'} on Discover, in the order they appear.
		</p>

		{#if editingPresets}
		<ul class="presets">
			{#each presets as label, i (label)}
				<li>
					<span class="plabel">{label}</span>
					<button
						class="ctl"
						disabled={i === 0}
						aria-label={`Move ${label} up`}
						onclick={() => movePreset(i, -1)}
					>↑</button>
					<button
						class="ctl"
						disabled={i === presets.length - 1}
						aria-label={`Move ${label} down`}
						onclick={() => movePreset(i, 1)}
					>↓</button>
					<button class="ctl remove" aria-label={`Remove ${label}`} onclick={() => removePreset(label)}>×</button>
				</li>
			{/each}
		</ul>

		<form class="addrow" onsubmit={(e) => { e.preventDefault(); addPreset(); }}>
			<input
				bind:value={newPreset}
				type="text"
				placeholder="Add a mood — body swap, road trip"
				autocapitalize="off"
				autocorrect="off"
			/>
			<button type="submit" disabled={!newPreset.trim() || presetBusy}>
				{presetBusy ? '…' : 'Add'}
			</button>
		</form>
		{#if presetError}<p class="error">{presetError}</p>{/if}
		{#if local.moodPresets}
			<button class="reset" onclick={() => patch({ moodPresets: null })}>Reset to defaults</button>
		{/if}
		{/if}
	</section>

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
</main>

<style>
	/* Sheet supplied the padding and the scroll container; a page has to do both
	   itself, including clearing the tab bar and the home indicator. */
	main {
		padding: 4px var(--gutter) calc(var(--tabbar-h) + var(--safe-b) + 32px);
	}

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
	.sechead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
	.sechead h3 { flex: 1; }
	.disclose { flex: none; font-size: 13px; font-weight: 600; color: var(--signal-solid); }

	.accent { display: flex; align-items: center; gap: 7px; }
	.swatch {
		flex: none; width: 16px; height: 16px; border-radius: 50%;
		/* Selected chips fill with the accent gradient, which would swallow the
		   swatch; the ring keeps it legible against its own colour. Drawn from
		   the surface it sits on so it reads on either appearance. */
		box-shadow: 0 0 0 1.5px var(--surface);
	}

	.toggle {
		flex: none; width: 46px; height: 28px; padding: 3px;
		border-radius: 14px; background: var(--bg);
		transition: background 160ms ease;
	}
	.toggle.on { background: var(--signal); }
	.knob {
		display: block; width: 22px; height: 22px; border-radius: 50%;
		/* White in both appearances, like a physical switch. --text would track
		   the appearance and turn the knob black on a light page, which reads as
		   a hole rather than a control. The shadow is what separates it from a
		   pale track. */
		background: #fff; box-shadow: var(--shadow-sm);
		transition: transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.toggle.on .knob { transform: translateX(18px); }

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

	.presets { margin: 0 0 8px; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
	.presets li {
		display: grid; grid-template-columns: 1fr auto auto auto;
		align-items: center; gap: 2px;
		border-radius: var(--radius); background: var(--surface-raised);
	}
	.plabel { padding: 0 4px 0 14px; font-size: 14.5px; font-weight: 600; }
	.ctl {
		width: 36px; height: var(--tap);
		font-size: 17px; color: var(--text-dim);
	}
	.ctl:disabled { opacity: 0.25; }
	.remove { padding-right: 10px; font-size: 21px; }

	.addrow { display: flex; gap: 8px; }
	.addrow input { flex: 1; min-width: 0; margin-bottom: 0; }
	.addrow button {
		flex: none; min-height: 40px; padding: 0 16px; border-radius: var(--radius);
		background: var(--signal); color: #fff; font-size: 14px; font-weight: 600;
	}
	.addrow button:disabled { opacity: 0.5; }
	.reset { margin-top: 10px; font-size: 13px; font-weight: 600; color: var(--signal-solid); }

	.error { margin: 8px 0 0; font-size: 13px; color: #ff8a8a; }
</style>
