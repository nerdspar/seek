<script lang="ts">
	import type { Tracking } from '$lib/tracking';
	import { statusLabel } from '$lib/tracking';

	/**
	 * Where you are with something, what you thought of it, and who you watched
	 * it with — three facts, three chips, one row.
	 *
	 * They used to share two controls: the status carried the rating as a
	 * passenger, and on a film "Completed" and a separate "Watched" button said
	 * the same thing twice. Company had no place on the page at all.
	 *
	 * The columns are fixed rather than sized to their contents, so rating
	 * something or switching to Together never moves the chip next to it. That
	 * matters more than it sounds: the row is tapped repeatedly, and a target
	 * that shifts under your thumb is the actual complaint.
	 */
	type Props = {
		mediaType: 'tv' | 'movie';
		tracking: Tracking;
		/** True for a film that has a play recorded. Ignored for shows. */
		watched?: boolean;
		joint: boolean;
		showCompany?: boolean;
		busy?: boolean;
		/** Films toggle watched directly; shows open the status picker. */
		onmain: () => void;
		onrating: () => void;
		oncompany: () => void;
	};
	let {
		mediaType,
		tracking,
		watched = false,
		joint,
		showCompany = true,
		busy = false,
		onmain,
		onrating,
		oncompany
	}: Props = $props();

	const isFilm = $derived(mediaType === 'movie');
	const mainLabel = $derived(
		isFilm ? (watched ? 'Watched' : 'Mark watched') : (statusLabel(tracking.status) ?? 'Set status')
	);
	/* A film's middle chip reports a fact, so it fills when true. A show's opens a
	   picker, so it fills whenever a status is set — it is never "off". */
	const mainOn = $derived(isFilm ? watched : tracking.status !== null);
</script>

<div class="chips" class:solo={!showCompany}>
	{#if showCompany}
		<button
			class="chip side"
			class:on={joint}
			disabled={busy}
			aria-pressed={joint}
			aria-label={joint ? 'Watched together — switch to alone' : 'Watched alone — switch to together'}
			onclick={oncompany}
		>
			{#if joint}
				<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2" /><circle cx="16.5" cy="9.5" r="2.6" /><path d="M3.2 19a6 6 0 0 1 11.6 0M16 13.6a5 5 0 0 1 4.8 4.2" /></svg>
			{:else}
				<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4" /><path d="M5.5 19a6.5 6.5 0 0 1 13 0" /></svg>
			{/if}
		</button>
	{/if}

	<button class="chip main" class:on={mainOn} disabled={busy} onclick={onmain}>
		{#if isFilm && watched}
			<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
		{:else if isFilm}
			<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9" /></svg>
		{/if}
		<span>{mainLabel}</span>
	</button>

	<button
		class="chip side"
		class:on={tracking.score !== null}
		disabled={busy}
		aria-label={tracking.score !== null ? `Rated ${tracking.score} — change` : 'Rate this'}
		onclick={onrating}
	>
		<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.85z" /></svg>
		{#if tracking.score !== null}<span class="tnum">{tracking.score}</span>{/if}
	</button>
</div>

<style>
	.chips {
		display: grid;
		grid-template-columns: var(--chip-side) var(--chip-main) var(--chip-side);
		gap: 6px;
		margin-bottom: 16px;
	}
	/* With company off the row is just the two, keeping the same proportions. */
	.chips.solo { grid-template-columns: var(--chip-main) var(--chip-side); }

	.chip {
		display: flex; align-items: center; justify-content: center; gap: 6px;
		min-height: var(--tap); border-radius: var(--radius);
		background: var(--surface); color: var(--text-dim);
		font-size: 14px; font-weight: 600;
	}
	.chip.on { background: var(--signal); color: #fff; }
	.chip:disabled { opacity: 0.6; }
	/* Never narrower than a thumb, whatever the ratio above is set to. */
	.side { min-width: var(--chip-min); padding: 0 6px; }
	.main { padding: 0 12px; }
	.main span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
