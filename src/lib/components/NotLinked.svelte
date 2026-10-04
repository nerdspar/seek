<script lang="ts">
	import type { LinkService } from '$lib/notLinked';

	/** Shown in place of a tab's content when it needs an account this person
	 *  hasn't linked yet — the normal first state for a new household member. */
	let { service }: { service: LinkService } = $props();

	const COPY: Record<LinkService, { title: string; body: string }> = {
		floppy: {
			title: 'Link your Floppy account',
			body: 'Your watchlist, shows, stats and Upcoming come from your own Floppy. Add your Floppy calendar link to see them.'
		},
		hardcover: {
			title: 'Link your Hardcover account',
			body: 'What you read, want to read and rate lives on your own Hardcover shelf. Add your Hardcover token to see it.'
		},
		bookorbit: {
			title: 'Link your BookOrbit account',
			body: 'Your books, reading progress and goals come from your own BookOrbit login.'
		}
	};
	const copy = $derived(COPY[service]);
</script>

<div class="notlinked">
	<h2>{copy.title}</h2>
	<p>{copy.body}</p>
	<a class="go" href="/profile/settings?s=accounts">Open Settings</a>
</div>

<style>
	.notlinked {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 48px var(--gutter);
		text-align: center;
	}
	h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 650;
	}
	p {
		margin: 0;
		max-width: 300px;
		font-size: 14px;
		line-height: 1.45;
		color: var(--text-dim);
	}
	.go {
		margin-top: 10px;
		padding: 11px 20px;
		border-radius: var(--radius);
		background: var(--signal);
		color: #fff;
		font-weight: 600;
	}
</style>
