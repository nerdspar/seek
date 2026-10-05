<script lang="ts">
	/** Discover's way into what's on the server but not on your list: Sonarr /
	 *  Radarr titles you don't track, or the BookOrbit library. One tappable row
	 *  above the suggestions, the same on TV, Movies and Books. */
	type Props = { title: string; sub: string; href: string };
	let { title, sub, href }: Props = $props();
</script>

<a class="entry" {href}>
	<span class="ico" aria-hidden="true">
		<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="6.5" rx="1.5" /><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5" /><path d="M7 7.25h.01M7 16.75h.01" /></svg>
	</span>
	<span class="text">
		<span class="t">{title}</span>
		<span class="s tnum">{sub}</span>
	</span>
	<span class="chev" aria-hidden="true">›</span>
</a>

<style>
	.entry {
		display: flex; align-items: center; gap: 12px;
		margin: 0 var(--gutter) 22px; padding: 10px 14px 10px 12px; min-height: 56px;
		border-radius: 12px; background: var(--surface); color: var(--text); text-decoration: none;
	}
	.ico { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 9px; background: var(--surface-raised); color: var(--text-dim); }
	.text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
	.t { font-size: 15px; font-weight: 600; }
	.s { font-size: 12.5px; color: var(--text-dim); }
	.chev { font-size: 20px; color: var(--text-dim); }
</style>
