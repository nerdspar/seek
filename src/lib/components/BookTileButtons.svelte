<script lang="ts">
	import type { DiscoveryCard } from '$lib/books';

	/** The two corner buttons on a book cover, like a show's: + puts it on your
	 *  want-to-read list (✓ once it's yours or in your library); the tray
	 *  downloads it, and once it's in the library that corner is the accent
	 *  inbox — a show's "in Sonarr" mark. Siblings of the cover button, not
	 *  inside it, so a tap here never opens the sheet. */
	type Props = {
		card: DiscoveryCard;
		/** Download is offered only with a BookOrbit login. */
		canDownload: boolean;
		onadd: (card: DiscoveryCard) => void;
		ondownload: (card: DiscoveryCard) => void;
	};
	let { card, canDownload, onadd, ondownload }: Props = $props();
	const have = $derived(Boolean(card.owned || card.mine));
</script>

<span class="add">
	<button
		class:on={have}
		aria-label={card.owned ? `${card.title} is in your library` : have ? `${card.title} is on your list` : `Want to read ${card.title}`}
		onclick={() => onadd(card)}
	>
		{#if have}
			<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7" /></svg>
		{:else}
			<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
		{/if}
	</button>
</span>
{#if card.owned}
	<span class="dl">
		<span class="inlib" role="img" aria-label={`${card.title} is in my library`} title="In my library">
			<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
		</span>
	</span>
{:else if canDownload}
	<span class="dl">
		<button aria-label={`Download ${card.title}`} onclick={() => ondownload(card)}>
			<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
		</button>
	</span>
{/if}

<style>
	.add { position: absolute; right: 5px; bottom: 5px; }
	.dl { position: absolute; right: 5px; top: 5px; }
	button {
		display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
		background: color-mix(in srgb, var(--bg) 88%, transparent); color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	button.on { background: var(--signal); color: #fff; }
	/* ArrButton's "in Sonarr": the solid accent, not the gradient. */
	.inlib {
		display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%;
		background: var(--signal-solid); color: #fff; box-shadow: var(--shadow-sm);
	}
</style>
