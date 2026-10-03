<script lang="ts">
	import AuthShell from '$lib/components/AuthShell.svelte';
	let { data } = $props();
</script>

{#if data.verified}
	<AuthShell title="Email confirmed" subtitle="{data.email} is verified — Seek can now send you a reset link if you ever need one.">
		<p class="links"><a href="/">Open Seek</a></p>
	</AuthShell>
{:else}
	<AuthShell title="This link has expired" subtitle="Confirmation links last 3 days. You can send a new one from Settings.">
		<p class="links"><a href="/">Open Seek</a></p>
	</AuthShell>
{/if}
