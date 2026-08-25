<script lang="ts">
	import Sheet from './Sheet.svelte';
	import type { MarkDirection, Prefs } from '$lib/server/prefs';

	/** Preferences live server-side in /data (§8), so this edits them through the
	 *  API rather than localStorage — the same values drive the server render. */
	type Props = { prefs: Prefs; onsaved: (p: Prefs) => void; onclose: () => void };
	let { prefs, onsaved, onclose }: Props = $props();

	/* Optimistic edit layered over the prop, so a save that fails simply reverts
	   by clearing it. */
	let edited = $state<Prefs | null>(null);
	const local = $derived(edited ?? prefs);
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

<Sheet label="Settings" {onclose}>
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

		<p class="note">Theme, default tab and streaming services are still to come.</p>
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

	.error { margin: 0 0 12px; font-size: 13px; color: #ff8a8a; }
	.note { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--text-dim); }
</style>
