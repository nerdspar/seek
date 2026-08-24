<script lang="ts">
	type Props = { title: string; subtitle?: string | null; onback: () => void };
	let { title, subtitle = null, onback }: Props = $props();
</script>

<header>
	<button class="back" onclick={onback} aria-label="Back">
		<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="m15 18-6-6 6-6" />
		</svg>
	</button>
	<div class="titles">
		<span class="title">{title}</span>
		{#if subtitle}<span class="subtitle">{subtitle}</span>{/if}
	</div>
</header>

<style>
	header {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px var(--gutter) 6px 4px;
		padding-top: calc(6px + var(--safe-t));
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(12px);
	}
	.back {
		flex: none;
		display: grid;
		place-items: center;
		width: var(--tap);
		height: var(--tap);
		border-radius: 50%;
	}
	.titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.title {
		font-size: 16px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.subtitle {
		font-size: 12px;
		color: var(--text-dim);
	}
</style>
