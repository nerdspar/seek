<script lang="ts">
	import { goto } from '$app/navigation';

	type Tab = 'watchlist' | 'upcoming' | 'discover' | 'profile';

	type Props = { current: Tab; onunbuilt?: (label: string) => void };
	let { current, onunbuilt }: Props = $props();

	const TABS: { id: Tab; label: string; href: string | null }[] = [
		{ id: 'watchlist', label: 'Watchlist', href: '/' },
		{ id: 'upcoming', label: 'Upcoming', href: '/upcoming' },
		{ id: 'discover', label: 'Discover', href: '/discover' },
		{ id: 'profile', label: 'Profile', href: '/profile' }
	];

	function activate(tab: (typeof TABS)[number]) {
		if (tab.id === current) return;
		if (tab.href) return void goto(tab.href);
		onunbuilt?.(tab.label);
	}

	const enabled = (tab: (typeof TABS)[number]) => Boolean(tab.href);
</script>

<nav class="tabbar">
	{#each TABS as tab (tab.id)}
		{@const active = tab.id === current}
		<button
			class:active
			disabled={!enabled(tab) && !active}
			aria-current={active ? 'page' : undefined}
			onclick={() => activate(tab)}
		>
			<!-- Filled when active, outlined when not: the gradient is reserved for
			     the active tab icon (§10), so the fill has to carry the state. -->
			<svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true">
				{#if tab.id === 'watchlist'}
					<!-- Stacked cards — the list you work through. -->
					<rect x="3" y="6" width="18" height="13" rx="2.5" fill={active ? 'url(#tabGrad)' : 'none'} stroke="currentColor" stroke-width="1.7" />
					<path d="M6.5 3.5h11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
				{:else if tab.id === 'upcoming'}
					<!-- Calendar. -->
					<rect x="3" y="5" width="18" height="16" rx="2.5" fill={active ? 'url(#tabGrad)' : 'none'} stroke="currentColor" stroke-width="1.7" />
					<path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
				{:else if tab.id === 'discover'}
					<!-- Compass. -->
					<circle cx="12" cy="12" r="9" fill={active ? 'url(#tabGrad)' : 'none'} stroke="currentColor" stroke-width="1.7" />
					<path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z" fill={active ? 'var(--bg)' : 'none'} stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
				{:else}
					<!-- Person. -->
					<circle cx="12" cy="8" r="3.6" fill={active ? 'url(#tabGrad)' : 'none'} stroke="currentColor" stroke-width="1.7" />
					<path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" fill={active ? 'url(#tabGrad)' : 'none'} stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
				{/if}
			</svg>
			{tab.label}
		</button>
	{/each}
</nav>

<!-- One gradient definition shared by every active icon. Zero-sized so it never
     affects layout. -->
<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">
	<defs>
		<linearGradient id="tabGrad" x1="0" y1="1" x2="1" y2="0">
			<stop offset="0%" stop-color="var(--signal-from)" />
			<stop offset="100%" stop-color="var(--signal-to)" />
		</linearGradient>
	</defs>
</svg>

<style>
	.tabbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 50;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		height: calc(var(--tabbar-h) + var(--safe-b));
		padding-bottom: var(--safe-b);
		background: var(--bg);
		border-top: 1px solid var(--surface);
	}
	.tabbar button {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 3px;
		font-size: 10.5px;
		font-weight: 600;
		color: var(--text-dim);
	}
	.tabbar button.active {
		color: var(--text);
	}
	.tabbar button:disabled {
		opacity: 0.4;
	}
	.tabbar svg {
		/* The stroke tracks the label colour; the fill is the gradient. */
		overflow: visible;
	}
</style>
