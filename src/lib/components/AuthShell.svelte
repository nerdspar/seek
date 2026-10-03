<script lang="ts">
	import type { Snippet } from 'svelte';

	/** The frame every account page shares (sign in, setup, invite, reset):
	 *  the gradient wordmark, a heading, and a narrow centred column. Inputs,
	 *  buttons and messages inside it are styled here so the pages stay identical. */
	type Props = { title?: string; subtitle?: string | null; children: Snippet };
	let { title, subtitle = null, children }: Props = $props();
</script>

<main class="auth">
	<p class="mark">Seek</p>
	{#if title}<h1>{title}</h1>{/if}
	{#if subtitle}<p class="sub">{subtitle}</p>{/if}
	<div class="body">{@render children()}</div>
</main>

<style>
	main {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: var(--gutter);
	}
	.mark {
		margin: 0 0 6px;
		font-size: 26px;
		font-weight: 700;
		background: var(--signal);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	h1 {
		margin: 0;
		font-size: 19px;
		font-weight: 650;
		text-align: center;
	}
	.sub {
		margin: 0;
		max-width: 320px;
		font-size: 13.5px;
		line-height: 1.45;
		color: var(--text-dim);
		text-align: center;
	}
	.body {
		width: 100%;
		max-width: 320px;
		margin-top: 10px;
	}
	.auth :global(form) {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.auth :global(input) {
		min-height: var(--tap);
		padding: 0 14px;
		border: none;
		border-radius: var(--radius);
		background: var(--surface-raised);
		color: var(--text);
		font: inherit;
		/* 16px stops iOS zooming the page when a field takes focus. */
		font-size: 16px;
	}
	.auth :global(button[type='submit']) {
		min-height: var(--tap);
		border-radius: var(--radius);
		background: var(--signal);
		color: #fff;
		font-weight: 600;
	}
	.auth :global(button[type='submit']:disabled) {
		opacity: 0.6;
	}
	.auth :global(.error) {
		margin: 0;
		font-size: 13px;
		color: #ff8a8a;
	}
	.auth :global(.note) {
		margin: 0;
		font-size: 13px;
		line-height: 1.45;
		color: var(--text-dim);
	}
	.auth :global(.links) {
		display: flex;
		justify-content: center;
		gap: 16px;
		margin-top: 14px;
		font-size: 13px;
	}
	.auth :global(.links a) {
		color: var(--signal-solid);
		font-weight: 600;
	}
</style>
