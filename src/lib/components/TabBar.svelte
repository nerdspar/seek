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
		<button
			class:active={tab.id === current}
			disabled={!enabled(tab) && tab.id !== current}
			aria-current={tab.id === current ? 'page' : undefined}
			onclick={() => activate(tab)}
		>
			<span class="dot"></span>
			{tab.label}
		</button>
	{/each}
</nav>

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
		gap: 5px;
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
	.dot {
		width: 18px;
		height: 18px;
		border-radius: 5px;
		background: var(--surface-raised);
	}
	.tabbar button.active .dot {
		background: var(--signal);
	}
</style>
